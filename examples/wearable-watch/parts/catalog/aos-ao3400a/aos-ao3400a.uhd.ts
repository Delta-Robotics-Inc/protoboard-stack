/**
 * Alpha & Omega Semiconductor AO3400A 30 V N-channel MOSFET (SOT23) —
 * datasheet-honest UHD part.
 *
 * Sources (see ./aos-ao3400a/sources.json):
 *   - src_datasheet: AOS AO3400A datasheet Rev 3.1 (July 2023) —
 *     https://www.aosmd.com/res/datasheets/AO3400A.pdf
 *   - src_package: AOS SOT23 package outline PO-00001 version N —
 *     https://www.aosmd.com/sites/default/files/res/package/SOT23.pdf
 *   - src_product: AOS AO3400A product page —
 *     https://www.aosmd.com/products/mosfets/low-voltage-mosfets-12v-30v/ao3400a
 *   - src_marking: AOS AO3400A marking description PD-00659 version C —
 *     https://www.aosmd.com/sites/default/files/res/markings/AO3400A.pdf
 *   - src_reliability: AOS AO3400A reliability report rev C —
 *     https://www.aosmd.com/sites/default/files/res/reliability_reports/AO3400A.pdf
 *   - src_pinout_community: Components101 AO3400A pinout (pin numbers only) —
 *     https://components101.com/mosfets/ao3400a-n-channel-mosfet-pinout-datasheet
 *   - src_jlc: JLCPCB catalog through jlcsearch (C20917) —
 *     https://jlcsearch.tscircuit.com/components/list.json?search=AO3400A
 *   - src_datasheet_ao3400: AOS AO3400 (no A) datasheet Rev 8 (Dec 2011),
 *     cited only to show it is a different part —
 *     https://www.aosmd.com/res/datasheets/AO3400.pdf
 *
 * Modelling notes:
 *   - Variant: AOS AO3400A only. AO3400 (no A) is an older AOS part with
 *     different ratings (5.8 A, RDS(ON) < 28 / 33 / 52 mOhm in its Rev 8
 *     datasheet), and many catalog rows named "AO3400A" are
 *     second-source devices with different RDS(ON) and capacitance; neither
 *     is evidence for this part (usage_note "variant").
 *   - Three leaves `pin_1`..`pin_3`, one per lead, with designators. The
 *     datasheet names the leads G, S and D and puts the pin-1 dot at G, but
 *     no AOS document prints pin numbers; 1 G, 2 S, 3 D come from a community
 *     source and agree with the dot and the usual SOT-23 numbering
 *     (assumption trait "pin numbers").
 *   - Gate (pin 1) is a logic `input` that also accepts `pwm` (the datasheet
 *     names PWM applications). Its `voltage` range is the ±12 V VGS absolute
 *     maximum, measured to the source: the datasheet has no recommended gate
 *     range (data_gap), so a net above 12 V is the only thing this flags.
 *     RDS(ON) is specified at VGS 2.5, 4.5 and 10 V; VGS(th) is 0.65-1.45 V.
 *   - Drain (pin 3) and source (pin 2) are `passive` terminals, not supply
 *     or ground pins: a MOSFET conducts between them, it neither supplies nor
 *     draws a rail. Used low-side (the watch's backlight switch) the source
 *     sits on GND and the drain on the load's return; high-side the source
 *     would sit on the load. The drain carries the VDS 0-30 V rating and the
 *     5.7 A continuous / 30 A pulsed drain current as parameters.
 *   - No composed interface: UHD has no switch protocol, and a load switch
 *     is a board-level net arrangement (gate drive, pull-down, load), not a
 *     port of the transistor.
 *   - Body diode (S anode, D cathode), capacitances, gate charge and
 *     switching times are in a `performance` trait.
 *   - Geometry: generated from AOS PO-00001 (AOS publishes no 3D model).
 *     Bare SMD transistor: no bolt pattern; each pin leaf refs its foot and
 *     `pcb_mount` refs all three feet with a frame on the seating plane.
 *     Nominal dimensions; standoff, shoulder height and the pin-1 mark are an
 *     assumption trait.
 *   - verify-part may report "no mechanical bolt pattern": intended, a bare
 *     SMD part is soldered by its leads.
 */
import type { InterfaceDef, ModuleDef, TraitDef } from "@deltarobotics/uhd";
import { burstCurrentA, defineModule, maxCurrentA, pinTable, voltageRangeV } from "@deltarobotics/uhd";
import { cadArtifacts, feature, own, withGeometry } from "./cad/artifacts.js";

const SRC = {
  datasheet: "https://www.aosmd.com/res/datasheets/AO3400A.pdf",
  package: "https://www.aosmd.com/sites/default/files/res/package/SOT23.pdf",
  product: "https://www.aosmd.com/products/mosfets/low-voltage-mosfets-12v-30v/ao3400a",
  marking: "https://www.aosmd.com/sites/default/files/res/markings/AO3400A.pdf",
  reliability: "https://www.aosmd.com/sites/default/files/res/reliability_reports/AO3400A.pdf",
  pinoutCommunity: "https://components101.com/mosfets/ao3400a-n-channel-mosfet-pinout-datasheet",
  jlc: "https://jlcsearch.tscircuit.com/components/list.json?search=AO3400A",
  datasheetAo3400: "https://www.aosmd.com/res/datasheets/AO3400.pdf",
} as const;

const VGS_ABS: [number, number] = [-12, 12]; // p.1 absolute maximum
const VDS_MAX = 30; // p.1 absolute maximum
const ID_CONT_A = 5.7; // p.1, TA 25 C
const IDM_A = 30; // p.1, note C

const note = (text: string, where: string): TraitDef => ({
  type: "usage_note",
  params: { note: text, source: `${SRC.datasheet} (${where})` },
});

// ---------------------------------------------------------------------------
// Pins — datasheet p.1 SOT23 top view (G, S, D); numbers per the assumption
// ---------------------------------------------------------------------------

const PIN_SOURCE = `${SRC.datasheet} (p.1 SOT23 top/bottom view and symbol); numbers ${SRC.pinoutCommunity}`;

const pins: InterfaceDef[] = pinTable(
  [
    {
      pin: 1,
      name: "G",
      type: "input",
      voltageV: VGS_ABS,
      capabilities: ["mosfet_gate", "pwm_in"],
      protocols: [{ type: "pwm", roles: ["input"] }],
      description: "G — gate (N-channel MOSFET symbol, p.1); lead next to the pin-1 dot in the SOT23 top view.",
      traits: [
        note(
          "VGS ±12 V absolute maximum (to S). VGS(th) 0.65 / 1.05 / 1.45 V (min / typ / max) at VDS = VGS, ID 250 uA. RDS(ON) max 48 mOhm at VGS 2.5 V (ID 3 A), 32 mOhm at 4.5 V (5 A), 26.5 mOhm at 10 V (5.7 A), so a 3.0-3.3 V logic output switches it fully on. IGSS 100 nA max at ±12 V. Ciss 630 pF, Rg 1.5-4.5 Ohm, Qg 6 typ / 7 max nC at 4.5 V. No ESD protection diode on the gate.",
          "p.1, p.2",
        ),
      ],
    },
    {
      pin: 2,
      name: "S",
      type: "passive",
      capabilities: ["mosfet_source"],
      description: "S — source (N-channel MOSFET symbol, p.1); anode of the body diode.",
    },
    {
      pin: 3,
      name: "D",
      type: "passive",
      capabilities: ["mosfet_drain"],
      description: "D — drain (N-channel MOSFET symbol, p.1); cathode of the body diode; the single lead on the far side in the SOT23 top view.",
      traits: [
        note(
          "VDS 30 V absolute maximum (BVDSS 30 V min). ID 5.7 A continuous at TA 25 C, 4.7 A at TA 70 C; IDM 30 A pulsed (repetitive, pulse width limited by TJ 150 C); ID(ON) 30 A min at VGS 4.5 V. Continuous ratings assume 1 in2 2 oz FR-4 copper; a smaller pad dissipates less. IDSS 1 uA max at VDS 30 V (5 uA at TJ 55 C).",
          "p.1, p.2, notes A-C",
        ),
      ],
    },
  ],
  { source: PIN_SOURCE },
).map((p) =>
  p.id === "pin_3"
    ? { ...p, parameters: [...(p.parameters ?? []), voltageRangeV(0, VDS_MAX), maxCurrentA(ID_CONT_A), burstCurrentA(IDM_A)] }
    : p,
);

const pinId = (n: number) => `pin_${n}`;

const pcbMount: InterfaceDef = {
  id: "pcb_mount",
  name: "SOT23 leads (SMD)",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "mechanical_connection", roles: ["mounting_point"] }],
  capabilities: ["surface_mount"],
  traits: [
    {
      type: "connector",
      params: {
        connector_type: "sot23_3",
        note: "3 gull-wing leads: pins 1 and 2 1.90 mm apart (e1) on one side, pin 3 centred on the other (e 0.95). Lead width 0.30-0.50, thickness 0.08-0.20, foot 0.30-0.60 mm (gauge plane); body 2.80-3.10 x 1.40-1.80 mm, span 2.60-3.00 mm, height 0.85-1.25 mm, standoff 0-0.15 mm; no exposed pad. MSL 1 (260 C reflow).",
        source: [`${SRC.package} (PO-00001)`, `${SRC.reliability} (note A)`],
      },
    },
  ],
};

// ---------------------------------------------------------------------------
// Module
// ---------------------------------------------------------------------------

const AOS_AO3400A_BASE: ModuleDef = defineModule({
  id: "aos-ao3400a",
  name: "AOS AO3400A 30 V N-channel MOSFET (SOT23)",
  version: "1.0.0",
  manufacturer: "Alpha & Omega Semiconductor",
  part_number: "AO3400A",
  description:
    "Alpha & Omega AO3400A trench N-channel enhancement MOSFET in a 3-lead SOT23: VDS 30 V, VGS ±12 V, 5.7 A continuous (TA 25 C), 30 A pulsed, RDS(ON) below 26.5 mOhm at VGS 10 V, 32 mOhm at 4.5 V and 48 mOhm at 2.5 V, VGS(th) 0.65-1.45 V, 1.4 W at TA 25 C. A logic-level load switch or PWM switch.",
  tags: ["ao3400a", "aos", "alpha-omega", "mosfet", "n-channel", "logic-level", "load-switch", "sot-23", "sot23", "discrete", "transistor"],
  categories: ["component.discrete.transistor"],

  interfaces: [...pins, pcbMount],

  domains: [
    {
      domain: "electrical",
      metadata: {
        device: "N-channel enhancement MOSFET (trench), with body diode",
        vds_max_V: VDS_MAX,
        vgs_max_V: 12,
        id_continuous_A: { ta_25C: 5.7, ta_70C: 4.7 },
        id_pulsed_A: IDM_A,
        pd_W: { ta_25C: 1.4, ta_70C: 0.9 },
        vgs_th_V: [0.65, 1.05, 1.45],
        rds_on_mOhm: {
          vgs_10V_id_5p7A: { typ: 18, max: 26.5 },
          vgs_10V_tj_125C: { typ: 28, max: 38 },
          vgs_4p5V_id_5A: { typ: 19, max: 32 },
          vgs_2p5V_id_3A: { typ: 24, max: 48 },
        },
        idss_uA: { max_25C: 1, max_tj_55C: 5 },
        igss_nA_max: 100,
        esd_diode: false,
        source: [`${SRC.datasheet} (p.1, p.2)`, `${SRC.product} (parametrics)`],
      },
    },
    {
      domain: "mechanical",
      dimensions_mm: { length: 2.9, width: 2.8, height: 1.25 },
      package: {
        name: "SOT23",
        code: "AOS PO-00001",
        pin_count: 3,
        pitch_mm: 0.95,
        exposed_pad: false,
        source: `${SRC.package} (PO-00001 version N: D 2.80/2.90/3.10, E 2.60/2.80/3.00, E1 1.40/1.60/1.80, A 0.85-1.25, e 0.95 BSC, e1 1.90 BSC); ${SRC.datasheet} (p.1 SOT23 view)`,
      },
      metadata: {
        body_mm: "D 2.80-3.10 x E1 1.40-1.80; lead span E 2.60-3.00; height A 0.85-1.25; standoff A1 0-0.15",
        dimensions_note: "length along the lead rows (body D, nominal), width across the leads (span E, nominal), height is the drawing maximum A",
        mounting_method: "surface_mount",
        msl: "1 (J-STD-020)",
        marking: "X0 + year/week + assembly location; lot code (PD-00659)",
        source: [SRC.package, SRC.marking, SRC.reliability, SRC.product],
      },
    },
    {
      domain: "thermal",
      operating_temperature_C: [-55, 150],
      metadata: {
        temperature_note: "The datasheet gives the junction and storage range (TJ, TSTG -55 to 150 C) only; no separate ambient range.",
        rtheta_ja_C_per_W: { t_le_10s: { typ: 70, max: 90 }, steady_state: { typ: 100, max: 125 } },
        rtheta_jl_C_per_W: { typ: 63, max: 80 },
        test_board: "1 in2 FR-4, 2 oz copper, still air, TA 25 C",
        source: `${SRC.datasheet} (p.1 thermal characteristics, notes A, D)`,
      },
    },
  ],

  traits: [
    {
      type: "absolute_maximum",
      params: {
        vds_V: VDS_MAX,
        vgs_V: VGS_ABS,
        id_continuous_A: { ta_25C: 5.7, ta_70C: 4.7 },
        id_pulsed_A: IDM_A,
        pd_W: { ta_25C: 1.4, ta_70C: 0.9 },
        junction_and_storage_temperature_C: [-55, 150],
        note: "TA 25 C unless noted. PD is based on TJ(MAX) 150 C and the t <= 10 s RthJA; IDM is repetitive, pulse width limited by TJ(MAX).",
        source: `${SRC.datasheet} (p.1 absolute maximum ratings, notes B, C)`,
      },
    },
    {
      type: "operating_conditions",
      params: {
        junction_temperature_C: [-55, 150],
        gate_drive_specified_V: [2.5, 4.5, 10],
        note: "No recommended-operating table; RDS(ON) is specified at VGS 2.5, 4.5 and 10 V, characteristics at TJ 25 C.",
        source: `${SRC.datasheet} (p.1, p.2)`,
      },
    },
    {
      type: "performance",
      params: {
        kind: "mosfet",
        polarity: "N-channel",
        rds_on_max_mOhm: { vgs_10V: 26.5, vgs_4p5V: 32, vgs_2p5V: 48 },
        vgs_th_V: [0.65, 1.05, 1.45],
        gfs_S: 33,
        capacitance_pF: { ciss: 630, coss: 75, crss: 50, conditions: "VGS 0 V, VDS 15 V, 1 MHz" },
        gate_resistance_ohm: [1.5, 3, 4.5],
        gate_charge_nC: { qg_typ: 6, qg_max: 7, qgs: 1.3, qgd: 1.8, conditions: "VGS 4.5 V, VDS 15 V, ID 5.7 A" },
        switching_ns: { td_on: 3, tr: 2.5, td_off: 25, tf: 4, conditions: "VGS 10 V, VDS 15 V, RL 2.6 Ohm, RGEN 3 Ohm" },
        body_diode: { vsd_V: { typ: 0.7, max: 1, at_is_A: 1 }, is_max_A: 2, trr_ns: 8.5, qrr_nC: 2.6 },
        source: `${SRC.datasheet} (p.2 electrical characteristics)`,
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "application",
        note: "Suitable as a load switch or in PWM applications. Power dissipation is ID^2 x RDS(ON) plus switching loss; TJ = TA + RthJA x PD with RthJA 100 typ / 125 max C/W steady state on 1 in2 of 2 oz copper.",
        source: `${SRC.datasheet} (p.1 general description, thermal characteristics)`,
      },
    },
    {
      type: "usage_note",
      params: {
        topic: "variant",
        note: "Order the AOS part: JLCPCB C20917 (basic part, 1,535,925 in stock on 2026-10-02 through the jlcsearch mirror) lists values that match this datasheet. Other catalog rows named AO3400A (for example C347475, C344010, C700953) state different RDS(ON), capacitance and thresholds and are second-source devices. AO3400 (no A) is a different AOS part with different ratings (5.8 A, RDS(ON) < 28 / 33 / 52 mOhm at 10 / 4.5 / 2.5 V). AO3400AL carries the same marking code X0.",
        source: [SRC.jlc, SRC.marking, `${SRC.datasheetAo3400} (AO3400 Rev 8, p.1)`],
      },
    },
    {
      type: "assumption",
      params: {
        field: "pin numbers",
        value: "pin 1 = G, pin 2 = S, pin 3 = D",
        reason: "AOS documents name the leads and put the pin-1 dot at G (datasheet p.1) but print no numbers. The numbers come from a community pinout page and match the dot and counter-clockwise SOT-23 numbering (pins 1 and 2 on one side, pin 3 opposite).",
        source: [SRC.datasheet, SRC.pinoutCommunity],
      },
    },
    {
      type: "source_discrepancy",
      params: {
        field: "marking code",
        values: ["X0", "A09T"],
        sources: [SRC.marking, SRC.pinoutCommunity],
        resolution: "X0, from the AOS marking description; the community page is used only for pin numbers.",
      },
    },
    {
      type: "data_gap",
      params: {
        field: "recommended gate drive range",
        note: "The datasheet has no recommended-operating table; the gate pin's voltage range is the ±12 V absolute maximum.",
        source: SRC.datasheet,
      },
    },
    {
      type: "data_gap",
      params: {
        field: "operating ambient temperature",
        note: "Only the junction and storage range TJ, TSTG -55 to 150 C is given; thermal.operating_temperature_C carries that range. The allowed ambient depends on dissipation and RthJA.",
        source: SRC.datasheet,
      },
    },
    {
      type: "data_gap",
      params: {
        field: "mass",
        note: "Not stated in the datasheet, package outline, product page or reliability report.",
        source: [SRC.datasheet, SRC.package, SRC.product, SRC.reliability],
      },
    },
    {
      type: "data_gap",
      params: {
        field: "manufacturer CAD",
        note: "The AOS product page offers datasheet, marking, reliability report, SOT23 package outline and tape & reel documents but no 3D model. Distributor ECAD portals were not used: their terms do not clearly permit redistribution. Geometry is generated from AOS PO-00001 (library/cad/py/catalog/aos-ao3400a.py).",
        source: [SRC.product, SRC.package],
      },
    },
    {
      type: "assumption",
      params: {
        field: "CAD package dimensions",
        value: "nominal values (body D 2.90 x E1 1.60, span E 2.80, lead b 0.40 x c 0.13, foot L 0.45, body thickness A2 1.05); body underside 0.075 mm above the seating plane (A1 midpoint), top at 1.125 mm; lead shoulder top 0.55 mm; square lead bends; pin-1 dimple 0.4 mm",
        reason: "PO-00001 gives only limits for A1 and L, no shoulder height or pin-1 mark size, and a 0-8 degree foot angle; the representative model needs single values.",
        source: SRC.package,
      },
    },
  ],

  artifacts: [
    { id: "art_datasheet", name: "AOS AO3400A datasheet Rev 3.1", type: "datasheet", url: SRC.datasheet },
    { id: "art_package", name: "AOS SOT23 package outline PO-00001", type: "documentation", url: SRC.package },
    { id: "art_product", name: "AOS AO3400A product page", type: "documentation", url: SRC.product },
    { id: "art_marking", name: "AOS AO3400A marking description PD-00659", type: "documentation", url: SRC.marking },
  ],
});

// ---------------------------------------------------------------------------
// Geometry: generated from AOS PO-00001. Seating plane z = 0, body centred on
// the origin, pins 1 (G) and 2 (S) on -X (pin 1 at +Y), pin 3 (D) on +X.
// ---------------------------------------------------------------------------

const PIN_FEATURES: Record<string, ReturnType<typeof feature>> = {
  pin_1: feature("pin_1", { area_mm2: 0.18, centroid: [-1.175, 0.95, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_2: feature("pin_2", { area_mm2: 0.18, centroid: [-1.175, -0.95, 0.0], normal: [0.0, 0.0, -1.0] }),
  pin_3: feature("pin_3", { area_mm2: 0.18, centroid: [1.175, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }),
};

export const AOS_AO3400A: ModuleDef = withGeometry(
  AOS_AO3400A_BASE,
  {
    [pinId(1)]: { refs: [PIN_FEATURES.pin_1] },
    [pinId(2)]: { refs: [PIN_FEATURES.pin_2] },
    [pinId(3)]: { refs: [PIN_FEATURES.pin_3] },
    // the leads onto the board: frame on the seating plane, normal out of the underside
    pcb_mount: {
      frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] },
      refs: [feature("pcb_mount", { area_mm2: 0.54, centroid: [-0.392, 0.0, 0.0], normal: [0.0, 0.0, -1.0] }), own("pcb_mount")],
    },
  },
  cadArtifacts({
    dir: "library/parts/aos-ao3400a/artifacts/cad",
    name: "aos-ao3400a-sot23",
    generator: "library/cad/py/catalog/aos-ao3400a.py",
    tool: "build123d 0.13.0",
    interfaces: ["pcb_mount"],
  }),
);

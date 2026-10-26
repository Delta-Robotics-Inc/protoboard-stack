/**
 * Harness modules of the 5-inch quadcopter (PB-790): the physical carriers of
 * interface links. Each is `kind: "harness"`.
 *
 * Cables (PB-805) are physical: each end is a connector composite, the
 * conductors are an internal link between the ends, and the system links the
 * ends to the parts' sockets (or, for a soldered end, to a link-scoped
 * composition of pads). UHD derives the power, UART, I2C and S.Bus links by
 * tracing the conductors. Mechanical joints still name the harness that
 * carries them (`InterfaceLink.harness`).
 *
 * Sources: the mating parts' sources (DolphinRC F405 V3 stack manual for the
 * SH1.0 8-pin cable, XT60 lead and M3 grommets; DJI O4 user manual for the
 * 3-in-1 cable). Hardware quantities for the stack bolts come from the
 * fastener parts once they are in the library (PB-791).
 *
 * Mechanical harnesses carry a `fastenerStack` (PB-775): where each part sits
 * along the joint's structure-side normal, from the structure face. `assemble`
 * places every screw, spacer, standoff and nut from it and checks that each
 * nut sits on thread.
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import type { InterfaceLink } from "@deltarobotics/uhd";
import { Connector } from "@deltarobotics/uhd";
import { routed } from "./routes.js";

/**
 * Installed cable lengths (mm): the length each cable is cut to or supplied
 * at, and what its routed geometry is fitted to. `protoboard run harness-cad`
 * reports the shortest clear route for each; a cable shorter than that does
 * not reach.
 */
export const XT60_LEAD_MM = 30;
export const GNSS_LEAD_MM = 97;
export const RX_WIRE_MM = 41;
export const CAP_LEAD_MM = 14;
export const PHASE_LEAD_MM: Record<string, number> = { arm_fr: 78, arm_rr: 78, arm_rl: 78, arm_fl: 78 };

/** FC <-> ESC SH1.0 8-pin order, from the BAT end (both parts). */
const SH8_PINS = ["BAT", "GND", "CUR", "VOID", "M1", "M2", "M3", "M4"];
import type { FastenerTorque } from "@deltarobotics/uhd";

// ---------------------------------------------------------------------------
// Tightening torques (PB-797). No frame, motor or DJI source states a torque
// for any of these joints (searched: MEPS, T-Motor, iFlight, BrotherHobby,
// ImpulseRC, TBS, GEPRC, DJI O4 manual, Westfield). So every value below is
// an ASSUMPTION, derated from published supplier tables for the screw grade
// into a steel nut, which do not apply to aluminium, nylon or PCB stacks:
// ---------------------------------------------------------------------------

const FASTENAL_A2 = "https://crafter.fastenal.com/static-assets/pdfs/technical-resources/Torque-Tension-Relationship-for-Metric-Stainless-Steel-Fasteners-A2-and-A4-70-Feb-2016.pdf";
const NPF = "https://www.npfasteners.com/technical/tightening-torques.htm";
const DJI_O4_MANUAL = "https://dl.djicdn.com/downloads/DJI_O4_Air_Unit_Series/UM/DJI_O4_Air_Unit_Series_User_Manual_v1.0_en.pdf";
const XTEAM_THREADLOCK = "https://www.x-teamrc.com/fpv-motor-screws-falling-out-installation-and-thread-locking-tips-explained/";

/** Supplier reference rows (steel nut or tapped steel; the tables' own caveat). */
const REF = {
  m3A2Dry: { torqueNm: 0.95, condition: "M3 A2-70, dry (K = 0.35), nut or tapped hole at least as strong as the bolt", source: FASTENAL_A2 },
  m3A2Lub: { torqueNm: 0.81, condition: "M3 A2-70, lubricated (K = 0.16)", source: FASTENAL_A2 },
  m3Class46: { torqueNm: 0.57, condition: "M3 steel class 4.6, 'generic reference values ... starting point'", source: NPF },
  m2Class46: { torqueNm: 0.17, condition: "M2 steel class 4.6", source: NPF },
  m2Class88: { torqueNm: 0.31, condition: "M2 steel class 8.8", source: NPF },
  m5Class46: { torqueNm: 2.7, condition: "M5 steel class 4.6, 'generic reference values ... starting point'", source: NPF },
};

const torque = (torqueNm: number, assumption: string, reference: FastenerTorque["reference"]): FastenerTorque => ({ torqueNm, assumption, reference });

const threadlockNote = (where: string) => ({
  type: "usage_note",
  params: {
    note: `Threadlocker: medium strength (blue) on the ${where}. Steel into aluminium with no locking element, so vibration can back the screws out. Advice is from X-Team's motor-screw guide, a secondary source; no maker of these parts states it.`,
    threadlocker: "medium",
    source: XTEAM_THREADLOCK,
  },
});

/** Conductors between two ends of a cable: straight through (p1→p1) unless `pairs` say otherwise. */
const wires = (a: string, b: string, pairs?: [string, string][]): InterfaceLink => ({
  id: "wires",
  name: "Conductors",
  a: { self: true, interfaceId: a },
  b: { self: true, interfaceId: b },
  ...(pairs ? { childLinks: pairs.map(([x, y]) => ({ a: x, b: y })) } : {}),
});

// ---------------------------------------------------------------------------
// Cable sources (parts/evidence/harnesses/sources.json has the fetched copies,
// quotes and dates). Every cable fact below cites one of these or is an
// `assumption` trait with its reason.
// ---------------------------------------------------------------------------

const SRC = {
  dolphinrcProduct: "https://dolphinrc.com/products/dolphinrc-f405-v3-50a-60a-stack",
  dolphinrcReview: "https://dolphinrc.com/blog/dolphinrc-f405-v3-50a-60a-stack-review",
  djiSpecs: "https://www.dji.com/o4-air-unit/specs",
  djiManual: DJI_O4_MANUAL,
  oscarSh6: "https://oscarliang.com/betafpv-matrix-3in1-fc/",
  mepsPage: "https://www.mepsking.shop/neon-2207-fpv-brushless-motor.html",
  mepsCombo: "https://www.mepsking.shop/4pcs-neon-2207-fpv-motors-with-4pairs-sz5145-propellers.html",
  rp1Page: "https://radiomasterrc.com/products/rp1-expresslrs-2-4ghz-nano-receiver",
  rp1Manual: "https://flymod.net/download/radiomaster_receiver_rp1_v2_manual",
  matekPage: "https://www.mateksys.com/?portfolio=m9n-5883",
  panasonicDs: "https://industrial.panasonic.com/cdbs/www-data/pdf/RDF0000/ABA0000C1259.pdf",
  ardupilotTwist: "https://ardupilot.org/copter/docs/common-magnetic-interference.html",
  oscarTwist: "https://oscarliang.com/wires-connectors/",
  jstSh: "https://www.jst-mfg.com/product/pdf/eng/eSH.pdf",
  jstGh: "https://www.jst-mfg.com/product/pdf/eng/eGH.pdf",
  xt60: "https://www.marutsu.co.jp/contents/shop/marutsu/datasheet/XT60H-M.pdf",
} as const;

const EVIDENCE = "parts/evidence/harnesses/sources.json";

/** Cable facts: length (routed to), conductors and, when known, gauge. */
const cable = (length_mm: number, conductors: number, wire_gauge_awg?: number, extra: Record<string, unknown> = {}) => ({
  type: "performance",
  params: { kind: "cable", length_mm, conductors, ...(wire_gauge_awg ? { wire_gauge_awg } : {}), evidence: EVIDENCE, ...extra },
});

/**
 * How the cable is built, for the routed geometry (@protoboardai/ext-harness-cad):
 * insulation colour per position of its first end, twisted or parallel, and
 * the conductor diameter when the gauge is not known.
 */
const build = (params: { colors: string[]; bundle: "twisted" | "parallel"; twist_pitch_mm?: number; od_mm?: number; bare?: boolean; strip_mm?: number; spacing_mm?: number; note: string; source?: string | string[] }) => ({
  type: "cable_build",
  params,
});

const assumption = (field: string, value: string, reason: string) => ({ type: "assumption", params: { field, value, reason } });

/** The 50 mm SH1.0 8-pin cable between the FC and the 4-in-1 ESC (ships with the stack). */
export const DOLPHINRC_SH8_FC_ESC_CABLE: ModuleDef = routed({
  id: "dolphinrc-sh8-fc-esc-cable",
  name: "FC/ESC SH1.0 8-pin cable",
  kind: "harness",
  topology: "wire",
  manufacturer: "DolphinRC",
  description: "50 mm SH1.0 8-pin cable joining the flight controller and the 4-in-1 ESC, wired 1:1 (BAT GND CUR VOID M1 M2 M3 M4).",
  tags: ["harness", "cable", "jst-sh"],
  display: { icon: "cable" },
  interfaces: [
    Connector({ id: "end_fc", name: "FC end", connector: "jst_sh_8", gender: "plug", pins: SH8_PINS }),
    Connector({ id: "end_esc", name: "ESC end", connector: "jst_sh_8", gender: "plug", pins: SH8_PINS }),
  ],
  links: [wires("end_fc", "end_esc")],
  traits: [
    { type: "usage_note", params: { note: "Included with the DolphinRC F405 V3 stack (manual: 'SH1.0mm 8Pin Cable 50mm'). Straight-through, so pin 1 maps to pin 1.", included_with: "dolphinrc-f405-v3-flight-controller", source: SRC.dolphinrcProduct } },
    cable(50, 8, undefined, { length_basis: "wire between the plug housings" }),
    build({ colors: Array(8).fill("black"), bundle: "parallel", od_mm: 0.95, note: "Eight loose conductors side by side between two JST SH housings (1.0 mm pitch; eSH.pdf).", source: SRC.jstSh }),
    assumption("conductor gauge and colour", "0.95 mm OD, black", "DolphinRC states neither; JST SH crimps take AWG 32–28 (eSH.pdf), so the drawn diameter is a 28 AWG silicone wire and the colour is neutral."),
  ],
});

/**
 * The DJI O4 3-in-1 cable: DJI 6-pin plug on the FC socket, the air unit's
 * own plug at the other end. Straight through: the FC socket's order
 * (10V G T5 R5 G Sbus) lands on the O4's (VCC GND RX TX GND S.Bus), so the
 * FC's TX5 reaches the O4's RX.
 */
export const DJI_O4_3IN1_CABLE: ModuleDef = routed({
  id: "dji-o4-3in1-cable",
  name: "DJI O4 3-in-1 cable",
  kind: "harness",
  topology: "wire",
  manufacturer: "DJI",
  description: "The O4 Air Unit's 50 mm 3-in-1 cable carrying power, ground, UART (MSP DisplayPort) and S.Bus to the flight controller's DJI socket.",
  tags: ["harness", "cable", "dji"],
  display: { icon: "cable" },
  interfaces: [
    Connector({ id: "end_fc", name: "FC end (DJI 6-pin)", connector: "dji_6pin", gender: "plug", pins: ["10V", "G", "T5", "R5", "G", "Sbus"] }),
    Connector({ id: "end_o4", name: "Air unit end", connector: "dji_3in1_cable_6pin", pins: ["VCC", "GND", "RX", "TX", "GND", "S.Bus"] }),
  ],
  links: [wires("end_fc", "end_o4")],
  traits: [
    { type: "usage_note", params: { note: "Ships with the DJI O4 Air Unit. Wire order VCC (red), GND (black), RX (white), TX (grey), GND (brown), S.Bus (yellow) (O4 user manual). DolphinRC also includes a 150 mm DJI 6-pin cable with the stack; the 50 mm DJI cable reaches here because the air unit sits right behind the stack.", included_with: "dji-o4-air-unit", source: [SRC.djiManual, SRC.djiSpecs, SRC.dolphinrcProduct] } },
    cable(50, 6, undefined, { length_basis: "DJI specs '3-in-1 Cable: 50 mm'" }),
    build({ colors: ["red", "black", "white", "grey", "brown", "yellow"], bundle: "parallel", od_mm: 0.8, note: "Six conductors side by side between two SH1.0 6-pin plugs (Oscar Liang: the FC side is an SH1.0 6-pin connector; DJI draws plugs on both ends and names no series).", source: [SRC.djiManual, SRC.oscarSh6] }),
    assumption("conductor gauge", "0.8 mm OD (about 30 AWG)", "DJI does not state it. JST SH crimps take AWG 32–28; an extended third-party DJI 3-in-1 cable is listed as 30 AWG."),
  ],
});

/** The ESC's 12 AWG battery lead: XT60 plug, the other end soldered to the ESC battery pads. */
export const DOLPHINRC_XT60_BATTERY_LEAD: ModuleDef = routed({
  id: "dolphinrc-xt60-battery-lead",
  name: "XT60 battery lead (12 AWG)",
  kind: "harness",
  topology: "wire",
  manufacturer: "DolphinRC",
  description: "12 AWG red/black lead with an XT60 male plug, cut to length and soldered to the ESC battery pads.",
  tags: ["harness", "power", "xt60"],
  display: { icon: "plug" },
  interfaces: [
    Connector({ id: "end_battery", name: "XT60 plug", connector: "xt60", gender: "male", pins: ["+", "-"] }),
    Connector({ id: "end_esc", name: "Soldered end", connector: "solder_leads", pins: ["+ (red)", "- (black)"] }),
  ],
  links: [wires("end_battery", "end_esc")],
  traits: [
    cable(XT60_LEAD_MM, 2, 12, { supplied_length_mm: 120, length_basis: "from the XT60 housing's rear to the pads" }),
    { type: "usage_note", params: { note: "Included with the stack (product page: '12AWG 12cm red/black lead and XT60 male plug'). Cut to length before soldering to the ESC pads. Solder the bundled 470 uF capacitor across the same pads.", included_with: "dolphinrc-am32-60a-4in1-esc", source: SRC.dolphinrcProduct } },
    build({ colors: ["red", "black"], bundle: "parallel", strip_mm: 3, note: "Two 12 AWG silicone leads side by side; AMASS XT60 male housing (16.4 x 9.2 mm, 7.2 mm pitch).", source: [SRC.dolphinrcProduct, SRC.xt60] }),
    assumption("lay", "flat pair, not twisted", "ArduPilot advises twisting battery leads to reduce magnetic interference, but this short lead runs back between the air unit and the FC's DJI plug, where a twisted pair (6.8 mm) does not fit; the two leads lie side by side."),
    assumption("installed length", `${XT60_LEAD_MM} mm`, "The supplied lead is 120 mm; in this layout the XT60 pair sits just behind the stack, so the lead is cut to the routed length."),
    assumption("XT60 housing colour", "yellow (AMASS standard)", "DolphinRC's listing does not show or state it."),
  ],
});

/**
 * The M9N's included JST-GH-6P lead (20 cm), one plug cut off and soldered
 * to the FC's pads: the FC's GPS socket has no I2C, so the compass needs the
 * SDA/SCL pads. Straight through in the M9N's order 5V RX TX CL DA G.
 */
export const MATEK_GH6P_GNSS_LEAD: ModuleDef = routed({
  id: "matek-gh6p-gnss-lead",
  name: "GNSS lead (GH6P, FC end soldered)",
  kind: "harness",
  topology: "wire",
  manufacturer: "Matek Systems",
  description: "JST-GH-6P silicone lead included with the M9N-5883, cut to length; the FC end is soldered to 4.5V, TX1, RX1, SCL, SDA and GND.",
  tags: ["harness", "cable", "jst-gh"],
  display: { icon: "cable" },
  interfaces: [
    Connector({ id: "end_gnss", name: "GH6P plug", connector: "jst_gh_6", gender: "plug", pins: ["5V", "RX", "TX", "CL", "DA", "G"] }),
    Connector({ id: "end_fc", name: "Soldered end", connector: "solder_leads", pins: ["5V", "RX", "TX", "CL", "DA", "G"] }),
  ],
  links: [wires("end_gnss", "end_fc")],
  traits: [
    cable(GNSS_LEAD_MM, 6, undefined, { supplied_length_mm: 200, length_basis: "from the GH housing's rear to the pads" }),
    { type: "usage_note", params: { note: "Included with the M9N-5883 ('JST-GH-6P to JST-GH-6P 20cm silicon wire'). Cut one plug off and solder to the FC pads: GNSS RX to TX1, GNSS TX to RX1. Plugged into GH6P-2, the socket facing the rear of the top plate (GH6P-1 faces the battery, 5 mm away).", included_with: "matek-m9n-5883", source: SRC.matekPage } },
    build({ colors: ["red", "yellow", "blue", "green", "white", "black"], bundle: "parallel", od_mm: 1.1, strip_mm: 2, note: "Six-wire flat silicone lead with a JST GH housing (1.25 mm pitch; eGH.pdf).", source: [SRC.matekPage, SRC.jstGh] }),
    assumption("installed length", `${GNSS_LEAD_MM} mm`, "The included lead is 20 cm; cut to the routed length when the far plug is removed."),
    assumption("colour per pin", "red 5V, yellow RX, blue TX, green CL, white DA, black G", "Matek's photo shows red, yellow, blue, green, white and black wires but not which pin each is on; drawn in the photo's order."),
    assumption("conductor gauge", "1.1 mm OD (about 26 AWG)", "Not stated; JST GH crimps take AWG 30–26 (eGH.pdf)."),
  ],
});

/**
 * One motor's phase leads: the MEPS motor's own three 150 mm leads, cut to
 * length and soldered to the ESC's phase pads. They are part of the motor
 * (wound into it), so the harness is "included with" the motor; it is a
 * harness because its installed length and route belong to this build. One
 * definition per corner: each carries its own routed geometry.
 */
const phaseLeads = (motor: number, arm: string, label: string): ModuleDef =>
  routed({
    id: `meps-phase-leads-m${motor}`,
    name: `Motor ${motor} phase leads (${label})`,
    kind: "harness",
    topology: "wire",
    manufacturer: "MEPS",
    description: `The three phase leads of the ${label.toLowerCase()} motor (M${motor}), cut to length, twisted and soldered to the ESC's motor ${motor} pads.`,
    tags: ["harness", "motor-leads", "power"],
    display: { icon: "cable" },
    interfaces: [
      Connector({ id: "end_motor", name: "Motor end (leads leave the heat shrink)", connector: "integral", pins: ["A", "B", "C"], note: "The leads continue into the motor windings: no connector." }),
      Connector({ id: "end_esc", name: "Soldered end", connector: "solder_leads", pins: ["A", "B", "C"] }),
    ],
    links: [wires("end_motor", "end_esc")],
    traits: [
      cable(PHASE_LEAD_MM[arm], 3, 20, { supplied_length_mm: 150, length_basis: "from the end of the 10 mm heat shrink to the pads" }),
      { type: "usage_note", params: { note: "The motor's own leads: 150 ± 2 mm, 10 mm heat shrink at the motor, 3 mm pre-tinned tips; three loose white silicone leads (MEPS page and photos). Cut to length, twisted to keep them tidy and reduce interference (Oscar Liang), soldered to the pads; swap any two to reverse the motor.", included_with: "meps-neon-2207-v2-1950kv", source: [SRC.mepsPage, SRC.oscarTwist] } },
      build({ colors: ["white", "white", "white"], bundle: "twisted", twist_pitch_mm: 24, strip_mm: 3, note: "Three white silicone leads, twisted after cutting.", source: [SRC.mepsPage, SRC.oscarTwist] }),
      assumption("wire gauge", "20 AWG", "The V2 page does not state it; MEPS's own 4-motor combo listing says 'Lead:20#150mm' (motor version not stated) and a reseller says 24#. See the motor part's source_discrepancy."),
      assumption("installed length", `${PHASE_LEAD_MM[arm]} mm`, "Cut to the routed length (the leads are 140 mm beyond the heat shrink as supplied); twisting uncut leads is the alternative."),
    ],
  });

/**
 * The RP1 V2's included wires: four silicone conductors (red, black, white,
 * green) soldered to the receiver's pads and to the FC's UART2, 5 V and GND
 * pads. Receiver TX goes to RX2 and RX to TX2 (the composition does the
 * crossover; the conductors are straight).
 */
export const RADIOMASTER_RP1_CRSF_WIRE: ModuleDef = routed({
  id: "radiomaster-rp1-crsf-wire",
  name: "Receiver wires (RP1 V2 CRSF wire)",
  kind: "harness",
  topology: "wire",
  manufacturer: "RadioMaster",
  description: "The four silicone wires included with the RP1 V2, twisted, soldered to the receiver's TX RX 5V G pads and the FC's RX2 TX2 5V GND pads.",
  tags: ["harness", "cable", "crsf"],
  display: { icon: "cable" },
  interfaces: [
    Connector({ id: "end_rx", name: "Receiver end (soldered)", connector: "solder_leads", pins: ["TX", "RX", "5V", "G"] }),
    Connector({ id: "end_fc", name: "FC end (soldered)", connector: "solder_leads", pins: ["RX2", "TX2", "5V", "GND"] }),
  ],
  links: [wires("end_rx", "end_fc")],
  traits: [
    cable(RX_WIRE_MM, 4, undefined, { length_basis: "pad to pad" }),
    { type: "usage_note", params: { note: "Package includes '1 * CRSF wire': four silicone wires, red, black, white and green, twisted, with bare tinned ends and no plug (product page and photo). Receiver TX to the FC's RX2, receiver RX to TX2 (ExpressLRS wiring guide).", included_with: "radiomaster-rp1-v2-elrs-2g4", source: [SRC.rp1Page, SRC.rp1Manual] } },
    build({ colors: ["green", "white", "red", "black"], bundle: "twisted", twist_pitch_mm: 14, od_mm: 1.1, strip_mm: 1.5, note: "Four twisted silicone wires as photographed.", source: SRC.rp1Page }),
    assumption("colour per pad", "green TX, white RX, red 5V, black G", "RadioMaster does not say which wire goes to which pad; red and black follow the power convention, the signal pair is arbitrary."),
    assumption("gauge and length", `1.1 mm OD, ${RX_WIRE_MM} mm`, "Neither is stated; cut to the routed length."),
  ],
});

/**
 * The bulk capacitor's own radial leads, trimmed and soldered into the ESC's
 * battery-pad holes ("Each side has a tiny hole to let you solder the
 * capacitor directly down", DolphinRC review). Bare tinned ø0.6 mm leads on a
 * 5 mm lead space (Panasonic datasheet). Included with the capacitor.
 */
export const BULK_CAPACITOR_LEADS: ModuleDef = routed({
  id: "panasonic-eeu-fr1v471-leads",
  name: "Bulk capacitor leads",
  kind: "harness",
  topology: "wire",
  manufacturer: "Panasonic Industry",
  description: "The capacitor's two ø0.6 mm radial leads, bent and trimmed, soldered across the ESC battery pads (+ to +).",
  tags: ["harness", "power", "component-leads"],
  display: { icon: "cable" },
  interfaces: [
    Connector({ id: "end_cap", name: "Capacitor end (leads leave the can)", connector: "integral", pins: ["+", "-"], note: "The leads are the capacitor's own." }),
    Connector({ id: "end_esc", name: "Soldered end", connector: "solder_leads", pins: ["+", "-"] }),
  ],
  links: [wires("end_cap", "end_esc")],
  traits: [
    cable(CAP_LEAD_MM, 2, undefined, { length_basis: "can to pad", supplied_length_note: "datasheet dimension drawing: lead length '14min.'" }),
    { type: "usage_note", params: { note: "The capacitor's own leads (ø0.6 ± 0.05 mm, lead space 5.0 ± 0.5 mm). Keep them short: the capacitor lies on the air unit behind the ESC, + lead to the + pad.", included_with: "panasonic-eeu-fr1v471", source: [SRC.panasonicDs, SRC.dolphinrcReview] } },
    build({ colors: ["tinned", "tinned"], bundle: "parallel", od_mm: 0.6, bare: true, spacing_mm: 5, note: "Two bare tinned leads, 5 mm apart.", source: SRC.panasonicDs }),
  ],
});

/**
 * The M3 hardware that bolts the frame, ESC and FC together — the "bolt
 * joining plates" harness. A bus: every board shares the same four bolts.
 */
export const QUADCOPTER_5IN_STACK_HARDWARE: ModuleDef = {
  id: "quadcopter-5in-stack-hardware",
  name: "Stack hardware (M3)",
  kind: "harness",
  topology: "bus",
  description: "Four M3 x 30 bolts through the frame's 30.5 mm stack holes, a 6 mm spacer, the ESC grommet, a 6 mm spacer and the FC grommet, closed by nyloc nuts.",
  tags: ["harness", "mechanical", "fasteners"],
  display: { icon: "wrench" },
  children: [
    { id: "screws", moduleDefId: "iso-4762-m3x30-socket-head-cap-screw", name: "M3 x 30 screw", quantity: 4 },
    { id: "spacers", moduleDefId: "ettinger-005-83-060-m3-nylon-spacer-6mm", name: "6 mm nylon spacer", quantity: 8 },
    { id: "nuts", moduleDefId: "iso-10511-m3-nyloc-nut", name: "M3 nyloc nut", quantity: 4 },
    { id: "esc_grommets", moduleDefId: "dolphinrc-m3-grommet-esc", name: "ESC grommet", quantity: 4 },
    { id: "fc_grommets", moduleDefId: "dolphinrc-m3-grommet-fc", name: "FC grommet", quantity: 4 },
  ],
  interfaces: [
    {
      id: "bolts",
      name: "4 x M3 through-bolts",
      domain: "mechanical",
      exposed: false,
      protocols: [{ type: "bolt_pattern", roles: ["component"] }],
      parameters: [
        { id: "hole_spacing", unit: "mm", value: 30.5 },
        { id: "fastener_diameter", unit: "mm", value: 3 },
      ],
    },
  ],
  // from the bottom plate's top face (z = 0): head under the 5 mm plate,
  // spacer, ESC grommet (6–10), spacer, FC grommet (16–20), nut (20–24)
  fastenerStack: [
    { child: "screws", atMm: -5 },
    { child: "spacers", atMm: 0 },
    { child: "esc_grommets", atMm: 6 },
    { child: "spacers", atMm: 10 },
    { child: "fc_grommets", atMm: 16 },
    {
      child: "nuts",
      atMm: 20,
      torque: torque(0.3, "Snug only: the clamp is two soft ESC/FC grommets and nylon spacers, which a full A2 M3 torque would crush and so detune the gyro isolation. About a third of the dry A2-70 table value. The nyloc insert locks the nut, so no threadlocker.", [REF.m3A2Dry, REF.m3Class46]),
    },
  ],
  traits: [
    { type: "usage_note", params: { note: "Per post, bottom to top: screw head under the 5 mm bottom plate, 6 mm spacer, ESC in its grommet (4 mm), 6 mm spacer, FC in its grommet (4 mm), nyloc nut; 1 mm of thread protrudes. Boards sit in the M3 grommets included with the DolphinRC stack (dolphinrc-m3-grommet-esc, -fc; four each, one spare each in the box), which the stack places. Stack-up worked out in the fastener parts' usage notes (assumes a 5 mm plate and 4 mm grommet clamp)." } },
  ],
};

const bolts = (id: string, name: string, size: number, spacing: number, spacingY?: number) => ({
  id,
  name,
  domain: "mechanical" as const,
  exposed: false,
  protocols: [{ type: "bolt_pattern", roles: ["component"] }],
  parameters: [
    { id: "hole_spacing", unit: "mm", value: spacing },
    ...(spacingY ? [{ id: "hole_spacing_y", unit: "mm", value: spacingY }] : []),
    { id: "fastener_diameter", unit: "mm", value: size },
  ],
});

/** One motor's four screws, up through the arm into the motor base. */
export const QUADCOPTER_5IN_MOTOR_HARDWARE: ModuleDef = {
  id: "quadcopter-5in-motor-hardware",
  name: "Motor hardware (M3)",
  kind: "harness",
  topology: "bus",
  description: "Four M3 x 8 screws (included with the motor) up through the arm pad into the motor base's 16 mm bolt circle.",
  tags: ["harness", "mechanical", "fasteners"],
  display: { icon: "wrench" },
  children: [{ id: "screws", moduleDefId: "motor-screw-m3x8", name: "M3 x 8 motor screw", quantity: 4 }],
  interfaces: [bolts("bolts", "4 x M3 on 16 mm", 3, 16)],
  // from the pad top (z = 0): heads under the 5 mm arm + 0.5 mm pad
  fastenerStack: [
    {
      child: "screws",
      atMm: -5.5,
      torque: torque(0.6, "An A2 M3 screw into the motor's aluminium base with about 2.5 mm of engagement. Derated from the dry A2-70 value (0.95 N·m, steel nut) for the short aluminium thread, which strips first. No motor maker states a torque.", [REF.m3A2Dry, REF.m3A2Lub]),
    },
  ],
  traits: [threadlockNote("motor screws")],
};

/** Standoffs and screws joining the bottom and top plates. */
export const QUADCOPTER_5IN_FRAME_HARDWARE: ModuleDef = {
  id: "quadcopter-5in-frame-hardware",
  name: "Frame hardware (M3 standoffs)",
  kind: "harness",
  topology: "bus",
  description: "Four 30 mm M3 aluminium standoffs, each held by an M3 x 8 screw from below the bottom plate and from above the top plate.",
  tags: ["harness", "mechanical", "fasteners"],
  display: { icon: "wrench" },
  children: [
    { id: "standoffs", moduleDefId: "m3-aluminium-standoff-30mm", name: "30 mm standoff", quantity: 4 },
    { id: "screws", moduleDefId: "iso-4762-m3x8", name: "M3 x 8 screw", quantity: 8 },
  ],
  interfaces: [bolts("bolts", "4 x M3 on 56 x 48 mm", 3, 56, 48)],
  // from the bottom plate's top face: screw from below, standoff 0–30, top plate 30–32, screw from above
  fastenerStack: [
    {
      child: "screws",
      atMm: -5,
      torque: torque(0.6, "An A2 M3 screw into an aluminium standoff's blind thread (3 mm engaged through the 5 mm plate), clamping carbon plate. Derated from the dry A2-70 value for the aluminium thread; hold the standoff with a spanner.", [REF.m3A2Dry, REF.m3Class46]),
    },
    { child: "standoffs", atMm: 0 },
    {
      child: "screws",
      atMm: 32,
      direction: -1,
      torque: torque(0.6, "As the lower screw: A2 M3 into the aluminium standoff (6 mm engaged through the 2 mm top plate).", [REF.m3A2Dry, REF.m3Class46]),
    },
  ],
  traits: [threadlockNote("standoff screws (lower and upper)")],
};

/** GPS: screws down through the board, spacers, nuts under the top plate. */
export const QUADCOPTER_5IN_GPS_HARDWARE: ModuleDef = {
  id: "quadcopter-5in-gps-hardware",
  name: "GPS hardware (M2)",
  kind: "harness",
  topology: "bus",
  description: "Four M2 x 12 screws down through the GPS board, 5 mm nylon spacers, and M2 nyloc nuts under the top plate.",
  tags: ["harness", "mechanical", "fasteners"],
  display: { icon: "wrench" },
  children: [
    { id: "screws", moduleDefId: "iso-4762-m2x12", name: "M2 x 12 screw", quantity: 4 },
    { id: "spacers", moduleDefId: "m2-nylon-spacer-5mm", name: "5 mm spacer", quantity: 4 },
    { id: "nuts", moduleDefId: "iso-10511-m2-nyloc-nut", name: "M2 nyloc nut", quantity: 4 },
  ],
  interfaces: [bolts("bolts", "4 x M2 on 26 mm", 2, 26)],
  // from the top plate's top face: nut under the 2 mm plate, spacer 0–5, board 5–5.62, screw head on the board
  fastenerStack: [
    { child: "nuts", atMm: -2, direction: -1 },
    { child: "spacers", atMm: 0 },
    {
      child: "screws",
      atMm: 5.62,
      direction: -1,
      torque: torque(0.1, "Snug only: an M2 screw clamping a 0.62 mm GPS PCB and nylon spacers into a nyloc nut. Well under the M2 class 4.6 steel value (0.17 N·m) so the board and spacers are not crushed. The nyloc locks it.", [REF.m2Class46, REF.m2Class88]),
    },
  ],
};

/** O4 transmission module on the bottom plate. */
export const QUADCOPTER_5IN_VTX_HARDWARE: ModuleDef = {
  id: "quadcopter-5in-vtx-hardware",
  name: "Air unit hardware (M2)",
  kind: "harness",
  topology: "bus",
  description: "Four M2 x 18 screws up through the bottom plate, 3 mm airflow spacers, the module, M2 nyloc nuts.",
  tags: ["harness", "mechanical", "fasteners"],
  display: { icon: "wrench" },
  children: [
    { id: "screws", moduleDefId: "iso-4762-m2x18", name: "M2 x 18 screw", quantity: 4 },
    { id: "spacers", moduleDefId: "m2-nylon-spacer-3mm", name: "3 mm spacer", quantity: 4 },
    { id: "nuts", moduleDefId: "iso-10511-m2-nyloc-nut", name: "M2 nyloc nut", quantity: 4 },
  ],
  interfaces: [bolts("bolts", "4 x M2 on 25.5 mm", 2, 25.5)],
  fastenerStack: [
    { child: "screws", atMm: -5 },
    { child: "spacers", atMm: 0 },
    {
      child: "nuts",
      atMm: 9,
      torque: torque(0.1, "Snug only: M2 through nylon airflow spacers and the O4 module's plastic-mounted holes into a nyloc nut; well under the M2 class 4.6 steel value (0.17 N·m). DJI: 'DO NOT overtighten the screws to avoid stripping.'", [REF.m2Class46]),
    },
  ],
};

const CAMERA_TORQUE = torque(0.1, "M2 x 5 A2 screws into the O4 camera's d1.65 tapped holes, whose thread material DJI does not state. DJI gives no value, only 'DO NOT overtighten the screws to avoid stripping.' Set well under the M2 class 4.6 steel value.", [REF.m2Class46]);

/** O4 camera between the side plates: two screws per side (O4 manual p.6). */
export const QUADCOPTER_5IN_CAMERA_HARDWARE: ModuleDef = {
  id: "quadcopter-5in-camera-hardware",
  name: "Camera hardware (M2)",
  kind: "harness",
  topology: "bus",
  description: "Four M2 x 5 screws through the 2 mm side plates into the camera's side holes, 16 mm apart: 3.0 mm into the camera, within DJI's 3.10 mm maximum.",
  tags: ["harness", "mechanical", "fasteners"],
  display: { icon: "wrench" },
  children: [{ id: "screws", moduleDefId: "iso-4762-m2x5", name: "M2 x 5 screw", quantity: 4 }],
  interfaces: [bolts("bolts", "2 x M2 per side, 16 mm", 2, 16, 14)],
  // frame: mid-plane of the clamp, normal toward the left plate, y = up; plates' outer faces at ±9
  fastenerStack: [
    { child: "screws", atMm: -9, positions: [[0, -8], [0, 8]], torque: CAMERA_TORQUE },
    { child: "screws", atMm: 9, direction: -1, positions: [[0, -8], [0, 8]], torque: CAMERA_TORQUE },
  ],
  traits: [
    {
      type: "usage_note",
      params: {
        note: "DJI O4 manual p.6: 'The screws included with the camera can only be used for frames thicker than 2 mm', and 'DO NOT overtighten the screws to avoid stripping.' These side plates are 2 mm, so bought M2 x 5 screws are used and the included ones are spare. No threadlocker: the camera's thread material is not stated.",
        source: DJI_O4_MANUAL,
      },
    },
  ],
};

/**
 * The propeller's nut (PB-836): the flanged lock nut that ships with each
 * motor, on the motor's M5 shaft over the 6 mm hub. The shaft is the thread
 * (UHD takes a shaft whose `shaft` trait states a thread as the screw of a
 * nut on it), so the stack is one nut.
 */
export const QUADCOPTER_5IN_PROP_HARDWARE: ModuleDef = {
  id: "quadcopter-5in-prop-hardware",
  name: "Prop nut (M5)",
  kind: "harness",
  topology: "bus",
  description: "The M5 flanged lock nut included with the motor, on the shaft over the propeller hub.",
  tags: ["harness", "mechanical", "fasteners"],
  display: { icon: "wrench" },
  children: [{ id: "nut", moduleDefId: "meps-m5-flanged-lock-nut", name: "Prop nut", quantity: 1 }],
  interfaces: [
    {
      id: "shaft",
      name: "M5 motor shaft",
      domain: "mechanical",
      exposed: false,
      protocols: [{ type: "shaft", roles: ["input"] }],
      parameters: [{ id: "shaft_diameter", unit: "mm", value: 5 }],
    },
  ],
  // from the bell top (the shaft frame, z = 0): hub 0–6 (HQProp: hub 6 mm thick), nut 6–11 on the shaft's 8 mm of thread (4.3–12.3)
  fastenerStack: [
    {
      child: "nut",
      atMm: 6,
      positions: [[0, 0]],
      torque: torque(1.0, "Snug only: the nut clamps a polycarbonate propeller hub on a steel shaft, and the nylon insert locks it. About a third of the M5 class 4.6 steel value so the hub is clamped without being crushed. No motor or propeller maker states a torque.", [REF.m5Class46]),
    },
  ],
  traits: [
    {
      type: "usage_note",
      params: {
        note: "Tighten until the hub is clamped and cannot slip on the shaft, holding the motor bell, then stop: the polycarbonate hub cracks if crushed. No motor or propeller maker states a torque; the stack's 1.0 N·m is an assumption. Check the nut before every flight. The nylon insert locks it.",
        source: ["https://img-meps.mepsking.top/material/1/meps-neon-2207-v2-motor-package.jpg", "https://www.hqprop.com/ethix-s5-light-grey-2cw2ccw-poly-carbonate-p0206.html"],
      },
    },
  ],
};

/** Phase leads per arm (Betaflight Quad-X numbering). */
export const PHASE_LEADS = {
  arm_rr: phaseLeads(1, "arm_rr", "Rear-right"),
  arm_fr: phaseLeads(2, "arm_fr", "Front-right"),
  arm_rl: phaseLeads(3, "arm_rl", "Rear-left"),
  arm_fl: phaseLeads(4, "arm_fl", "Front-left"),
};

export const HARNESSES: ModuleDef[] = [
  DOLPHINRC_SH8_FC_ESC_CABLE,
  DJI_O4_3IN1_CABLE,
  DOLPHINRC_XT60_BATTERY_LEAD,
  MATEK_GH6P_GNSS_LEAD,
  ...Object.values(PHASE_LEADS),
  RADIOMASTER_RP1_CRSF_WIRE,
  BULK_CAPACITOR_LEADS,
  QUADCOPTER_5IN_STACK_HARDWARE,
  QUADCOPTER_5IN_MOTOR_HARDWARE,
  QUADCOPTER_5IN_FRAME_HARDWARE,
  QUADCOPTER_5IN_GPS_HARDWARE,
  QUADCOPTER_5IN_VTX_HARDWARE,
  QUADCOPTER_5IN_CAMERA_HARDWARE,
  QUADCOPTER_5IN_PROP_HARDWARE,
];

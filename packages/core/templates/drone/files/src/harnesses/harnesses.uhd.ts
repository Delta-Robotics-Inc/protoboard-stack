/**
 * Harness modules (from the drone template, as in the quadcopter-5in
 * reference project): the physical carriers of interface links. Each is
 * `kind: "harness"`.
 *
 * Cables are physical: each end is a connector composite, the conductors are
 * an internal link between the ends, and the system links the ends to the
 * parts' sockets (or, for a soldered end, to a link-scoped composition of
 * pads). UHD derives the power and UART links by tracing the conductors.
 * Mechanical joints (screws, standoffs, nuts) are harnesses too, with a
 * `fastenerStack`: see quadcopter-5in's stack and frame hardware.
 *
 * Every cable fact cites a source (SRC; the fetched copies, quotes and dates
 * are in parts/evidence/harnesses/sources.json) or is an `assumption` trait
 * with its reason. Each cable has a provider directory, src/harnesses/<id>/,
 * with its cad.config.ts (@protoboardai/ext-harness-cad): `protoboard run
 * harness-cad` routes it through the assembled model once the parts have a
 * place (routes.ts attaches the routed geometry).
 */
import type { InterfaceLink, ModuleDef } from "@deltarobotics/uhd";
import { Connector } from "@deltarobotics/uhd";
import { routed } from "./routes.js";

/**
 * Installed cable lengths (mm): what each cable is cut to. Set them from the
 * layout once the stack and the battery have their places (`protoboard run
 * harness-cad` reports the shortest clear route for each).
 */
export const XT60_LEAD_MM = 120;
export const RX_WIRE_MM = 60;

/** FC <-> ESC SH1.0 8-pin order, from the BAT end (both parts). */
const SH8_PINS = ["BAT", "GND", "CUR", "VOID", "M1", "M2", "M3", "M4"];

/** Conductors between two ends of a cable: straight through (p1→p1) unless `pairs` say otherwise. */
const wires = (a: string, b: string, pairs?: [string, string][]): InterfaceLink => ({
  id: "wires",
  name: "Conductors",
  a: { self: true, interfaceId: a },
  b: { self: true, interfaceId: b },
  ...(pairs ? { childLinks: pairs.map(([x, y]) => ({ a: x, b: y })) } : {}),
});

const SRC = {
  dolphinrcProduct: "https://dolphinrc.com/products/dolphinrc-f405-v3-50a-60a-stack",
  rp1Page: "https://radiomasterrc.com/products/rp1-expresslrs-2-4ghz-nano-receiver",
  rp1Manual: "https://flymod.net/download/radiomaster_receiver_rp1_v2_manual",
  jstSh: "https://www.jst-mfg.com/product/pdf/eng/eSH.pdf",
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

/** The ESC's 12 AWG battery lead: XT60 plug, the other end soldered to the ESC battery pads. */
export const DOLPHINRC_XT60_BATTERY_LEAD: ModuleDef = routed({
  id: "dolphinrc-xt60-battery-lead",
  name: "XT60 battery lead (12 AWG)",
  kind: "harness",
  topology: "wire",
  manufacturer: "DolphinRC",
  description: "12 AWG red/black lead with an XT60 male plug, soldered to the ESC battery pads.",
  tags: ["harness", "power", "xt60"],
  display: { icon: "plug" },
  interfaces: [
    Connector({ id: "end_battery", name: "XT60 plug", connector: "xt60", gender: "male", pins: ["+", "-"] }),
    Connector({ id: "end_esc", name: "Soldered end", connector: "solder_leads", pins: ["+ (red)", "- (black)"] }),
  ],
  links: [wires("end_battery", "end_esc")],
  traits: [
    cable(XT60_LEAD_MM, 2, 12, { supplied_length_mm: 120, length_basis: "from the XT60 housing's rear to the pads" }),
    { type: "usage_note", params: { note: "Included with the stack (product page: '12AWG 12cm red/black lead and XT60 male plug'). Cut to length before soldering to the ESC pads.", included_with: "dolphinrc-am32-60a-4in1-esc", source: SRC.dolphinrcProduct } },
    build({ colors: ["red", "black"], bundle: "parallel", strip_mm: 3, note: "Two 12 AWG silicone leads side by side; AMASS XT60 male housing (16.4 x 9.2 mm, 7.2 mm pitch).", source: [SRC.dolphinrcProduct, SRC.xt60] }),
    assumption("installed length", `${XT60_LEAD_MM} mm`, "Uncut, as supplied, until the layout sets the routed length."),
    assumption("XT60 housing colour", "yellow (AMASS standard)", "DolphinRC's listing does not show or state it."),
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
    assumption("gauge and length", `1.1 mm OD, ${RX_WIRE_MM} mm`, "Neither is stated; cut to the routed length once the receiver has its place."),
  ],
});

/**
 * Fault scenarios for the smart bottle: each is the system with one
 * realistic mistake and the diagnostic code that must catch it. Not a
 * *.uhd.ts file, so these variants are never loaded as definitions.
 *
 *   npx tsx node_modules/@protoboardai/ext-hardware/skills/system-compose/scripts/scenarios.ts
 *
 * The board's own faults (a pin on the wrong rail, a short) are board
 * variants passed as `overrides`; wiring faults outside the board change the
 * system's links. Faults that only the firmware rules see (a second device
 * at one I2C address, a wake source on a non-RTC pin, a pin used twice) are
 * in scripts/firmware-scenarios.ts: UHD cannot see this board's I2C bus,
 * because the ESP32-C3 routes I2C through its GPIO matrix and states no I2C
 * controller interface (docs/decisions.md).
 */
import type { InterfaceLink, ModuleDef } from "@deltarobotics/uhd";
import { BoltPattern } from "@deltarobotics/uhd";
import { SMART_BOTTLE } from "./bottle.uhd.ts";
import { BOTTLE_CAP_BOARD } from "./boards/bottle-cap/bottle-cap.uhd.ts";
import { BOTTLE_CAP_ENCLOSURE } from "./enclosures/bottle-cap/bottle-cap.uhd.ts";

/** Re-point positions of a link-scoped composition (a wire soldered to a different pad). */
const recompose = (system: ModuleDef, id: string, patch: Record<string, string>): ModuleDef => ({
  ...system,
  links: (system.links ?? []).map((l) => (l.id === id && "child" in l.b && l.b.compose ? { ...l, b: { ...l.b, compose: { ...l.b.compose, ...patch } } } : l)),
});

/** A board variant: move pins between nets (the board's links are net-to-pin). */
const rewire = (moves: { pin: string; from: string; to: string }[], drop: string[] = []): ModuleDef => {
  const links: InterfaceLink[] = [];
  for (const l of BOTTLE_CAP_BOARD.links ?? []) {
    const ends = [l.a, l.b];
    const pin = ends.find((e) => "child" in e);
    const net = ends.find((e) => "self" in e);
    const key = pin && "child" in pin ? `${pin.child}:${pin.interfaceId}` : "";
    if (drop.some((d) => key.startsWith(`${d}:`))) continue;
    const mv = moves.find((m) => m.pin === key && net && net.interfaceId === m.from);
    links.push(mv ? { ...l, id: `${l.id}_moved`, [l.a === net ? "a" : "b"]: { self: true, interfaceId: mv.to } } : l);
  }
  return {
    ...BOTTLE_CAP_BOARD,
    children: (BOTTLE_CAP_BOARD.children ?? []).filter((c) => !drop.includes(c.id)),
    links,
  };
};

/** The cap's bosses on a Ø50 circle: the board's Ø54 holes miss them. */
const capBosses50: ModuleDef = {
  ...BOTTLE_CAP_ENCLOSURE,
  interfaces: BOTTLE_CAP_ENCLOSURE.interfaces.map((i) =>
    i.id === "board_mount"
      ? { ...i, ...BoltPattern({ id: "board_mount", name: "Board bosses on Ø50", role: "structure", shape: "circle", spacingMm: 50, holeCount: 4, fastener: "M2", fastenerDiameterMm: 2, threaded: true }), traits: i.traits, geometry: i.geometry }
      : i,
  ),
};

export const SCENARIOS = [
  { id: "nominal", label: "Nominal build", expect: [] },
  {
    id: "module-on-vbus",
    label: "ESP32-C3 module on USB VBUS",
    description: "The module's 3V3 pad is routed to VBUS (5 V) instead of the buck-boost output; the module takes 3.0-3.6 V.",
    expect: ["UHD_NET"],
    overrides: [rewire([{ pin: "u1:pin_3", from: "v3v3", to: "vbus" }])],
  },
  {
    id: "gauge-gnd-on-vbat",
    label: "Fuel gauge ground pad on VBAT",
    description: "The MAX17048's GND pin is routed to the VBAT net: the cell is shorted through the board.",
    expect: ["UHD_NET"],
    overrides: [rewire([{ pin: "u6:pin_4", from: "gnd", to: "vbat" }])],
  },
  {
    id: "cell-leads-reversed",
    label: "Cell leads soldered the wrong way round",
    description: "The red lead goes to BAT- and the black lead to BAT+.",
    expect: ["UHD_LINK_STATE"],
    system: recompose(SMART_BOTTLE, "bat_pads", { p1: "bat_neg", p2: "bat_pos" }),
  },
  {
    id: "probe-dq-on-gnd-pad",
    label: "Probe DQ and GND wires swapped",
    description: "The probe's data wire is soldered to the GND pad and its ground wire to the DQ pad.",
    expect: ["UHD_LINK_STATE"],
    system: recompose(SMART_BOTTLE, "probe_pads", { p2: "probe_gnd", p3: "probe_dq" }),
  },
  {
    id: "bosses-on-50mm",
    label: "Cap bosses on a Ø50 circle",
    description: "The cap's insert bosses are on a Ø50 mm circle; the board's holes are on Ø54.",
    expect: ["UHD_LINK_STATE"],
    overrides: [capBosses50],
  },
];

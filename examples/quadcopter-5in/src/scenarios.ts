/**
 * Fault scenarios for the quadcopter (after @deltarobotics/uhd
 * library/systems/quadcopter-5in/scenarios.ts, PB-789): each is the system
 * with one realistic mistake and the diagnostic code that must catch it.
 * Not a *.uhd.ts file, so these variants are never loaded as definitions.
 *
 *   npx tsx node_modules/@protoboardai/ext-hardware/skills/system-compose/scripts/scenarios.ts
 */
import type { ModuleDef } from "@deltarobotics/uhd";
import { BoltPattern } from "@deltarobotics/uhd";
import { QUADCOPTER_5IN } from "./quadcopter.uhd.ts";
import { QUADCOPTER_5IN_FRAME } from "./modules/frame/frame.uhd.ts";
import { ISO_4762_M2X12 } from "../parts/local/iso-4762-m2x12.uhd.ts";
import { QUADCOPTER_5IN_GPS_HARDWARE } from "./harnesses/harnesses.uhd.ts";

/** Re-point positions of a link-scoped composition (a wire soldered to a different pad). */
const recompose = (system: ModuleDef, id: string, patch: Record<string, string>): ModuleDef => ({
  ...system,
  links: (system.links ?? []).map((l) =>
    l.id === id && "child" in l.b && l.b.compose ? { ...l, b: { ...l.b, compose: { ...l.b.compose, ...patch } } } : l,
  ),
});

const frame20mm: ModuleDef = {
  ...QUADCOPTER_5IN_FRAME,
  interfaces: QUADCOPTER_5IN_FRAME.interfaces.map((i) =>
    i.id === "stack_mount"
      ? { ...BoltPattern({ id: "stack_mount", name: "Stack mount (20 x 20)", role: "structure", shape: "square", spacingMm: 20, holeCount: 4, fastener: "M2", fastenerDiameterMm: 2 }), geometry: i.geometry }
      : i,
  ),
};

// M2 x 10 in place of M2 x 12: 0.62 mm board + 5 mm spacer + 2 mm plate + 2.8 mm nut = 10.4 mm
const m2x10: ModuleDef = {
  ...ISO_4762_M2X12,
  id: "iso-4762-m2x10",
  interfaces: ISO_4762_M2X12.interfaces.map((i) => ({ ...i, parameters: i.parameters?.map((p) => (p.id === "length" ? { ...p, value: 10 } : p)) })),
};
const gpsShortScrews: ModuleDef = {
  ...QUADCOPTER_5IN_GPS_HARDWARE,
  children: QUADCOPTER_5IN_GPS_HARDWARE.children?.map((c) => (c.id === "screws" ? { ...c, moduleDefId: m2x10.id } : c)),
};

export const SCENARIOS = [
  { id: "nominal", label: "Nominal build", expect: [] },
  {
    id: "o4-on-vbat",
    label: "O4 wired to raw 6S",
    description: "The DJI O4 power lead is soldered to the battery instead of the 10 V BEC.",
    expect: ["UHD_LINK_STATE"],
    // The cable's red wire is cut off the DJI plug and soldered to the XT60
    // lead: positions 2-6 still mate, VCC now comes straight off the pack.
    system: {
      ...QUADCOPTER_5IN,
      links: [
        ...(QUADCOPTER_5IN.links ?? []).map((l) => (l.id === "dji_fc" ? { ...l, childLinks: [2, 3, 4, 5, 6].map((n) => ({ a: `p${n}`, b: `p${n}` })) } : l)),
        { id: "video_power", name: "O4 VCC on the pack", a: { child: "battery", interfaceId: "battery_out" }, b: { child: "video", interfaceId: "vcc" }, harness: "dji_cable" },
      ],
    },
  },
  {
    id: "frame-20mm-stack",
    label: "20 × 20 frame for a 30.5 stack",
    description: "The frame's stack mount is cut for a 20 × 20 mm M2 stack.",
    expect: ["UHD_LINK_STATE"],
    overrides: [frame20mm],
  },
  {
    id: "gps-on-rx-uart",
    label: "GPS on the receiver's UART",
    description: "The GNSS UART is wired to UART2, which the ELRS receiver already uses.",
    expect: ["UHD_INTERFACE_REUSE"],
    system: recompose(QUADCOPTER_5IN, "gnss_pads", { p2: "fc:uart2_tx", p3: "fc:uart2_rx" }),
  },
  {
    id: "gnss-rx-tx-swapped",
    label: "GNSS lead with RX and TX swapped",
    description: "The soldered end of the GNSS lead has its RX and TX wires on the wrong pads (GNSS TX on TX1).",
    expect: ["UHD_LINK_STATE"],
    system: recompose(QUADCOPTER_5IN, "gnss_pads", { p2: "fc:uart1_rx", p3: "fc:uart1_tx" }),
  },
  {
    id: "two-compasses",
    label: "Two compasses on one I2C bus",
    description: "A second M9N-5883 (compass at 0x2C) is added on the same I2C bus.",
    expect: ["UHD_BUS_ADDRESS"],
    system: {
      ...QUADCOPTER_5IN,
      children: [...(QUADCOPTER_5IN.children ?? []), { id: "gnss_2", moduleDefId: "matek-m9n-5883", name: "Second GNSS" }],
      links: [
        ...(QUADCOPTER_5IN.links ?? []),
        { id: "gnss2_i2c", name: "Compass 2", a: { child: "stack", interfaceId: "i2c1" }, b: { child: "gnss_2", interfaceId: "i2c_compass" } },
        { id: "gnss2_power", name: "GPS2 power", a: { child: "stack", interfaceId: "rail_4v5" }, b: { child: "gnss_2", interfaceId: "vin_5v" } },
      ],
    },
  },
  {
    id: "short-gps-screws",
    label: "M2 × 10 on the GPS",
    description: "The GPS hardware uses M2 × 10 screws, which stop inside the nyloc nut.",
    expect: ["UHD_ASSEMBLY"],
    overrides: [m2x10, gpsShortScrews],
  },
];

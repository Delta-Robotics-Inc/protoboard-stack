/**
 * Copper lands of the main board (from the wearable template, as in the
 * wearable-watch reference project's lands.uhd.ts): what the cell's leads and
 * a programmer touch. They are components of the board module so that the
 * board has pins for those nets and an edge (exports) the system can link
 * to; nothing is bought for them (each says it is included with the board:
 * it is the board's copper).
 *
 * Each pad states what the board does on it, seen from the board, the way a
 * development board's header does: the cell's + pad takes the battery and
 * gives the charge current. The SWD pads are plain copper (passive): a
 * programmer is not part of the product.
 *
 * Their land patterns (pad sizes) are the circuit provider's; here only the
 * facts a land pattern is chosen from: pin count, pitch, designators.
 */
import { Connector, Ground, PowerIn, PowerOut, defineModule, type InterfaceDef, type ModuleDef } from "@deltarobotics/uhd";

const included = { type: "usage_note", params: { topic: "bom", note: "Copper on the main board: fabricated with the PCB, nothing to buy or place.", included_with: "main-board" } };

/** Where a land sits on the board (its pads' mid-point, on the copper; normal into the board). */
const boardMount = (note: string): InterfaceDef => ({
  id: "board_mount",
  name: "On the board copper",
  domain: "mechanical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "custom", roles: ["peer"] }],
  capabilities: ["board_site"],
  geometry: { frame: { origin: [0, 0, 0], normal: [0, 0, -1], xAxis: [1, 0, 0] } },
  traits: [{ type: "usage_note", params: { note } }],
});
/** A pad's face, where a lead is soldered (normal out of the board). */
const padFrame = (x: number) => ({ frame: { origin: [x, 0, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], xAxis: [1, 0, 0] as [number, number, number] } });

const passive = (pin: number, name: string): InterfaceDef => ({ id: `pin_${pin}`, name, pin, domain: "electrical", exposed: true, default_active: true, protocols: [{ type: "passive", roles: ["terminal"] }] });

/**
 * The cell's lead pads (J3): the board takes the battery on pad 1 (VBAT,
 * every load) and gives it the charger's output (MCP73831 VBAT, RPROG 12 kOhm).
 */
export const CELL_PADS: ModuleDef = defineModule({
  id: "cell-pads",
  name: "Cell lead solder pads (2)",
  version: "0.1.0",
  description: "Two solder pads for the cell's AWG30 leads: pad 1 VBAT (+, red), pad 2 GND (-, black).",
  categories: ["connector.power_connector"],
  tags: ["land", "solder", "wire-leads", "battery", "board-copper"],
  interfaces: [
    {
      id: "pin_1",
      name: "VBAT (+)",
      pin: 1,
      domain: "electrical",
      exposed: true,
      default_active: true,
      protocols: [{ type: "power", roles: ["input", "output"] }],
      capabilities: ["battery_in", "battery_charge"],
      parameters: [{ id: "voltage", unit: "V", range: [3.0, 4.2], value: 3.7 }],
      geometry: padFrame(-1.0),
    },
    { ...Ground({ id: "pin_2", name: "GND (-)", pin: 2 }), geometry: padFrame(1.0) },
    boardMount("Pad 1 at x -1.0, pad 2 at x +1.0 from this frame, 2.0 mm apart (the board's land pattern)."),
    {
      ...PowerIn({ id: "battery_in", name: "Battery in (+ / -): the board's loads", voltageV: [3.0, 4.2], nominalV: 3.7 }),
      parameters: [{ id: "voltage", unit: "V", range: [3.0, 4.2], value: 3.7 }],
      slots: [
        { id: "pos", label: "+", required: true, match: { protocol: "power", role: "input", capability: "battery_in" } },
        { id: "gnd", label: "-", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
      ],
      profiles: [{ id: "default", label: "pad 1 + / pad 2 -", default_active: true, bindings: { pos: "pin_1", gnd: "pin_2" } }],
      max_instances: 1,
      traits: [{ type: "usage_note", params: { note: "State current_draw (the board's peak from the cell) here once the loads are known: so the power checks can compare it with the cell's ratings." } }],
    },
    {
      ...PowerOut({ id: "charge_out", name: "Charge out (+ / -): MCP73831, 4.20 V, 83 mA", voltageV: [4.168, 4.232], nominalV: 4.2, maxCurrentA: 0.0917 }),
      capabilities: ["battery_charge", "li_ion_1s"],
      slots: [
        { id: "vbat", label: "+", required: true, match: { protocol: "power", role: "output", capability: "battery_charge" } },
        { id: "gnd", label: "-", required: true, match: { protocol: "power", role: "ground", capability: "ground" } },
      ],
      profiles: [{ id: "default", label: "pad 1 + / pad 2 -", default_active: true, bindings: { vbat: "pin_1", gnd: "pin_2" } }],
      max_instances: 1,
      traits: [{ type: "usage_note", params: { note: "MCP73831-2AC regulation 4.20 V ±0.75 % (4.168-4.232 V); IREG = 1000 V / 12 kOhm = 83 mA nominal, 91.7 mA at the +10 % limit (DS20001984H §5, Electrical Characteristics)." } }],
    },
  ],
  domains: [{ domain: "mechanical", package: { name: "Wire lead pads 2P", pin_count: 2, pitch_mm: 2.0, exposed_pad: false, assumption: "Pad pitch is this board's choice for AWG30 leads (insulation about 1.1 mm)." } }],
  traits: [included],
});

/** Five programming pads for a pogo-pin clip (not a part). */
export const SWD_PADS: ModuleDef = defineModule({
  id: "swd-pads",
  name: "SWD test pads (5)",
  version: "0.1.0",
  description: "Programming and debug pads, reached with spring pins with the back cover off: 3V0 sense, SWDIO, SWDCLK, nRESET, GND.",
  categories: ["connector.signal_connector"],
  tags: ["land", "test-pads", "swd", "board-copper"],
  interfaces: [
    passive(1, "VTREF (3V0)"),
    passive(2, "SWDIO"),
    passive(3, "SWDCLK"),
    passive(4, "nRESET"),
    passive(5, "GND"),
    Connector({
      id: "swd",
      name: "SWD pads",
      connector: "test_pads_5p_1p27mm",
      pins: [
        ["VTREF", "pin_1"],
        ["SWDIO", "pin_2"],
        ["SWDCLK", "pin_3"],
        ["nRESET", "pin_4"],
        ["GND", "pin_5"],
      ],
      note: "Five 1.0 mm pads on 1.27 mm pitch, touched by spring pins; not a mating connector.",
    }),
  ],
  domains: [{ domain: "mechanical", package: { name: "SWD test pads 5P 1.27 mm", pin_count: 5, pitch_mm: 1.27, exposed_pad: false, assumption: "Pad size and pitch are this board's choice for a spring-pin clip." } }],
  traits: [included],
});

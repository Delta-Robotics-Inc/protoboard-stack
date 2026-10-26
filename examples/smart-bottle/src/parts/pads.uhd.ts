/**
 * Solder and test pads on the cap board (project-specific, smart-bottle).
 *
 * These are copper on the board, not purchased parts: the release lists them
 * as included with the board (`usage_note` with `included_with`), so nothing
 * is ordered for them. They are modules so the board can name each pad as a
 * component with a pin designator, give the circuit provider a land pattern
 * to place (its own table: src/boards/bottle-cap/tscircuit/footprints.json),
 * and export the pads the wire harnesses are soldered to.
 *
 * - `bottle-battery-pads`: the cell's two leads (bottle-battery-leads).
 * - `bottle-probe-pads`: the temperature probe's three wires
 *   (bottle-probe-cable). The probe itself is a system part
 *   (adafruit-381-ds18b20-probe); its DQ pad carries the 1-Wire data line,
 *   so that leaf states the line's function (`onewire_dq`, open drain) for
 *   the board's firmware map, and the probe's own leaf carries the device
 *   facts.
 * - `bottle-test-pad`: one bring-up pad (UART0, BOOT, EN, 3V3, GND).
 *
 * Frames: each pad's centre on the board surface, normal +Z (out of the
 * copper), in the land pattern's coordinates (footprints.json), so a harness
 * end routed to a pad lands where the copper is.
 *
 * Pad sizes are design choices (assumption traits): wire pads sized for 28 AWG
 * (cell leads, Ø0.38 mm conductor) and the probe's stranded wires, test pads
 * for a pogo pin or a probe tip.
 */
import type { InterfaceDef, ModuleDef } from "@deltarobotics/uhd";
import { Ground, defineModule, withGeometry } from "@deltarobotics/uhd";

const included = { type: "usage_note", params: { note: "Copper on the board, made with it: nothing to buy.", included_with: "bottle-cap-board" } };

const pad = (id: string, pin: string, name: string, extra: Partial<InterfaceDef> = {}): InterfaceDef => ({
  id,
  name,
  pin,
  domain: "electrical",
  exposed: true,
  default_active: true,
  protocols: [{ type: "passive", roles: ["terminal"] }],
  ...extra,
});

const pkg = (name: string, count: number, size: { length: number; width: number }, assumption: string) => ({
  domain: "mechanical" as const,
  dimensions_mm: { ...size, height: 0.05 },
  package: { name, pin_count: count, exposed_pad: false, assumption },
});

const BATTERY_PADS: ModuleDef = defineModule({
  id: "bottle-battery-pads",
  name: "Cell lead pads (2 × Ø2.0 mm)",
  description: "Two plated solder pads for the LP503450's leads: 1 = BAT+ (red), 2 = BAT- (black). Copper on the cap board.",
  categories: ["connector.signal_connector"],
  tags: ["solder-pad", "board-feature", "smart-bottle"],
  interfaces: [
    pad("pad_pos", "1", "BAT+ pad (red lead)", { protocols: [{ type: "power", roles: ["input"] }], capabilities: ["battery_in"] }),
    { ...Ground({ id: "pad_neg", name: "BAT- pad (black lead)" }), pin: "2" },
  ],
  domains: [pkg("Wire pads 2 x 2.0 mm", 2, { length: 5.5, width: 2 }, "Project-specific copper, no maker. Ø2.0 mm pads 3.5 mm apart for 28 AWG leads (design choice).")],
  traits: [included, { type: "assumption", params: { field: "pad size", value: "Ø2.0 mm, 3.5 mm apart", reason: "Room for a 28 AWG tinned lead and a soldering iron tip; not from a standard." } }],
});

const PROBE_PADS: ModuleDef = defineModule({
  id: "bottle-probe-pads",
  name: "Probe wire pads (3 × Ø1.8 mm)",
  description: "Three plated solder pads for the DS18B20 probe's wires: 1 = VDD (red), 2 = DQ (yellow/white), 3 = GND (black/blue). Copper on the cap board.",
  categories: ["connector.signal_connector"],
  tags: ["solder-pad", "board-feature", "smart-bottle"],
  interfaces: [
    pad("pad_vdd", "1", "VDD pad (red): 3V3 to the probe", { protocols: [{ type: "power", roles: ["bidirectional"] }], capabilities: ["probe_supply"], traits: [{ type: "usage_note", params: { note: "A pad on the 3V3 net: the probe draws its supply from the buck-boost through it. Role bidirectional: the pad passes the rail on; it is not a second source on the net." } }] }),
    pad("pad_dq", "2", "DQ pad (yellow/white): 1-Wire data to the probe", {
      protocols: [{ type: "digital", roles: ["bidirectional"] }],
      capabilities: ["digital_io", "onewire_dq", "open_drain"],
      traits: [{ type: "usage_note", params: { note: "The probe's 1-Wire DQ wire is soldered here (bottle-probe-cable). The line is the probe's (adafruit-381-ds18b20-probe wire_dq): open drain, pulled up on the board (r7, 4.7 kOhm)." } }],
    }),
    { ...Ground({ id: "pad_gnd", name: "GND pad (black/blue)" }), pin: "3" },
  ],
  domains: [pkg("Wire pads 3 x 1.8 mm", 3, { length: 7, width: 1.8 }, "Project-specific copper, no maker. Ø1.8 mm pads 2.6 mm apart (design choice).")],
  traits: [included, { type: "assumption", params: { field: "pad size", value: "Ø1.8 mm, 2.6 mm apart", reason: "Room for the probe's stranded wires (gauge not stated by Adafruit); not from a standard." } }],
});

export const BOTTLE_TEST_PAD: ModuleDef = defineModule({
  id: "bottle-test-pad",
  name: "Test pad (Ø1.2 mm)",
  description: "A bring-up test pad on the cap board (UART0 RX/TX, BOOT, EN, 3V3, GND): copper, for a pogo pin or probe tip.",
  categories: ["connector.signal_connector"],
  tags: ["test-pad", "board-feature", "smart-bottle"],
  interfaces: [pad("pad", "1", "Test pad")],
  domains: [pkg("Test pad 1.2 mm", 1, { length: 1.2, width: 1.2 }, "Project-specific copper, no maker. Ø1.2 mm (design choice).")],
  traits: [included, { type: "assumption", params: { field: "pad size", value: "Ø1.2 mm", reason: "Fits a 1 mm pogo pin; not from a standard." } }],
});

const up = (x: number, y: number) => ({ frame: { origin: [x, y, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], xAxis: [1, 0, 0] as [number, number, number] } });

/** Pads 3.5 mm apart along X: BAT+ at -X. */
export const BOTTLE_BATTERY_PADS: ModuleDef = withGeometry(BATTERY_PADS, { pad_pos: up(-1.75, 0), pad_neg: up(1.75, 0) }, []);

/** Pads 2.6 mm apart along X: VDD, DQ, GND from -X. */
export const BOTTLE_PROBE_PADS: ModuleDef = withGeometry(PROBE_PADS, { pad_vdd: up(-2.6, 0), pad_dq: up(0, 0), pad_gnd: up(2.6, 0) }, []);

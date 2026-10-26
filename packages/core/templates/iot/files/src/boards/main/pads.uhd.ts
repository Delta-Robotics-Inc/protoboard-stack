/**
 * Solder pads on the main board (from the iot template, as in the
 * smart-bottle reference project's src/parts/pads.uhd.ts).
 *
 * These are copper on the board, not purchased parts: the release lists them
 * as included with the board (`usage_note` with `included_with`), so nothing
 * is ordered for them. They are modules so the board can name each pad as a
 * component with a pin designator, give the circuit provider a land pattern
 * to place (tscircuit/footprints.json next to this file), and export the pads
 * the wire harnesses are soldered to.
 *
 * Frames: each pad's centre on the board surface, normal +Z (out of the
 * copper), in the land pattern's coordinates, so a harness end routed to a
 * pad lands where the copper is. Pad sizes are design choices (assumption traits).
 */
import type { InterfaceDef, ModuleDef } from "@deltarobotics/uhd";
import { Ground, defineModule, withGeometry } from "@deltarobotics/uhd";

const included = { type: "usage_note", params: { note: "Copper on the board, made with it: nothing to buy.", included_with: "main-board" } };

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
  id: "battery-pads",
  name: "Cell lead pads (2 × Ø2.0 mm)",
  description: "Two plated solder pads for the cell's leads: 1 = BAT+ (red), 2 = BAT- (black). Copper on the main board.",
  categories: ["connector.signal_connector"],
  tags: ["solder-pad", "board-feature"],
  interfaces: [
    pad("pad_pos", "1", "BAT+ pad (red lead)", { protocols: [{ type: "power", roles: ["input"] }], capabilities: ["battery_in"] }),
    { ...Ground({ id: "pad_neg", name: "BAT- pad (black lead)" }), pin: "2" },
  ],
  domains: [pkg("Wire pads 2 x 2.0 mm", 2, { length: 5.5, width: 2 }, "Project-specific copper, no maker. Ø2.0 mm pads 3.5 mm apart for 28 AWG leads (design choice).")],
  traits: [included, { type: "assumption", params: { field: "pad size", value: "Ø2.0 mm, 3.5 mm apart", reason: "Room for a 28 AWG tinned lead and a soldering iron tip; not from a standard." } }],
});

export const TEST_PAD: ModuleDef = defineModule({
  id: "test-pad",
  name: "Test pad (Ø1.2 mm)",
  description: "A bring-up test pad on the main board (BOOT, EN, GND): copper, for a pogo pin or probe tip.",
  categories: ["connector.signal_connector"],
  tags: ["test-pad", "board-feature"],
  interfaces: [pad("pad", "1", "Test pad")],
  domains: [pkg("Test pad 1.2 mm", 1, { length: 1.2, width: 1.2 }, "Project-specific copper, no maker. Ø1.2 mm (design choice).")],
  traits: [included, { type: "assumption", params: { field: "pad size", value: "Ø1.2 mm", reason: "Fits a 1 mm pogo pin; not from a standard." } }],
});

const up = (x: number, y: number) => ({ frame: { origin: [x, y, 0] as [number, number, number], normal: [0, 0, 1] as [number, number, number], xAxis: [1, 0, 0] as [number, number, number] } });

/** Pads 3.5 mm apart along X: BAT+ at -X. */
export const BATTERY_PADS_PLACED: ModuleDef = withGeometry(BATTERY_PADS, { pad_pos: up(-1.75, 0), pad_neg: up(1.75, 0) }, []);

/**
 * Smart water bottle — a Protoboard Stack reference system (PB-831..835).
 *
 * A sensor cap that replaces the stock lid of a Nalgene 32 oz Wide Mouth
 * bottle: it measures the water level by time of flight and the temperature
 * with a sealed DS18B20 probe, reminds the user to drink with a ring of RGB
 * LEDs, and syncs over Wi-Fi (docs/brief.md).
 *
 * Children: the cap's designed modules (src/boards/bottle-cap, the circuit
 * capability; src/enclosures/bottle-cap, the cad capability), catalog parts
 * (parts/catalog, pinned in parts/origins.json), purchased parts researched
 * here (parts/local), and harnesses (src/harnesses).
 *
 * Placement (cap frame: mm, z = 0 where the cap's floor meets the bottle's
 * lip, +Z toward the lid): the cap is the assembly root; the board sits on
 * its insert bosses and the bottle on the cap's lip seal (mates below). The
 * cell (taped onto the board's components), the probe (held by its rod
 * seal), the three O-rings (in their grooves) and the two pad components the
 * harnesses land on have display placements (.protoboard/display.json).
 */
import type { InterfaceLink, ModuleDef } from "@deltarobotics/uhd";

const link = (id: string, name: string, a: [string, string], b: [string, string], extra: Partial<InterfaceLink> = {}): InterfaceLink => ({
  id,
  name,
  a: { child: a[0], interfaceId: a[1] },
  b: { child: b[0], interfaceId: b[1] },
  ...extra,
});

export const SMART_BOTTLE: ModuleDef = {
  id: "smart-bottle",
  name: "Smart water bottle",
  kind: "module",
  version: "0.1.0",
  description:
    "Sensor cap for a Nalgene 32 oz Wide Mouth bottle: ESP32-C3 (Wi-Fi + BLE), VL53L4CD time-of-flight water level, Adafruit 381 DS18B20 temperature probe, LP5024 with 8 RGB LEDs, TPS63020 3V3, MCP73831 charger and MAX17048 fuel gauge on a 1000 mAh LP503450 cell, IP67 USB-C, in a printed PETG cap sealed with AS568 O-rings.",
  tags: ["smart-bottle", "reference-project", "esp32-c3", "iot"],
  display: { icon: "droplet" },
  interfaces: [],
  children: [
    { id: "cap", moduleDefId: "bottle-cap-enclosure", name: "Cap housing" },
    { id: "board", moduleDefId: "bottle-cap-board", name: "Cap board" },
    { id: "cell", moduleDefId: "lipol-lp503450", name: "LiPo cell" },
    { id: "probe", moduleDefId: "adafruit-381-ds18b20-probe", name: "Temperature probe" },
    { id: "bottle", moduleDefId: "nalgene-32oz-wide-mouth", name: "Bottle" },
    { id: "lip_oring", moduleDefId: "as568-138-silicone", name: "Lip seal O-ring" },
    { id: "lid_oring", moduleDefId: "as568-040-silicone", name: "Lid seal O-ring" },
    { id: "probe_oring", moduleDefId: "as568-010-silicone", name: "Probe seal O-ring" },
    { id: "battery_leads", moduleDefId: "bottle-battery-leads", name: "Cell leads" },
    { id: "probe_cable", moduleDefId: "bottle-probe-cable", name: "Probe cable" },
    { id: "board_hardware", moduleDefId: "bottle-board-hardware", name: "Board screws" },
  ],
  links: [
    // ---- mechanical: the board on the cap's bosses, the bottle on the cap's lip seal
    link("board_on_bosses", "Board on the cap's insert bosses", ["cap", "board_mount"], ["board", "mount"], { harness: "board_hardware" }),
    link("cap_on_bottle", "Cap on the bottle's lip", ["cap", "lip_seal"], ["bottle", "lip_seal"]),
    // ---- electrical: the cell's leads and the probe's cable, soldered to the board's pads
    {
      id: "cell_leads",
      name: "Cell leads leave the cell",
      a: { child: "cell", interfaceId: "leads", compose: { p1: "lead_pos", p2: "lead_neg" } },
      b: { child: "battery_leads", interfaceId: "end_cell" },
    },
    {
      id: "bat_pads",
      name: "Cell leads on the BAT pads",
      a: { child: "battery_leads", interfaceId: "end_board" },
      b: { child: "board", interfaceId: "bat_pads", compose: { p1: "bat_pos", p2: "bat_neg" } },
    },
    {
      id: "probe_wires",
      name: "Probe cable leaves the probe",
      a: { child: "probe", interfaceId: "wires", compose: { p1: "wire_vdd", p2: "wire_dq", p3: "wire_gnd" } },
      b: { child: "probe_cable", interfaceId: "end_probe" },
    },
    {
      id: "probe_pads",
      name: "Probe cable on the probe pads",
      a: { child: "probe_cable", interfaceId: "end_board" },
      b: { child: "board", interfaceId: "probe_pads", compose: { p1: "probe_vdd", p2: "probe_dq", p3: "probe_gnd" } },
    },
  ],
};

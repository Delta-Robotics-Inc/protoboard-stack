/**
 * Wearable watch — a Protoboard Stack reference system (PB-826..830).
 *
 * A round-display nRF52840 smartwatch: a custom main board (circuit
 * capability, src/boards/watch-main), a printed case (cad capability,
 * src/enclosures/watch-case), the display, the cell and the LRA, their lead
 * harnesses and the back-cover screws (src/harnesses), and two spring bars
 * for a 22 mm strap. The brief and its numbers are docs/brief.md;
 * component choices docs/component-selection.md; rails and pins
 * docs/system.md; battery life docs/power-budget.md.
 *
 * Stack, front to back (case frame, +Z towards the wrist): lens, display,
 * cell, main board (components facing the back cover), LRA bonded to the
 * back cover. The display is a component of the board: its FPC drops past
 * the cell and is soldered to the board's rear face (OQ-W5, resolved as
 * display / cell / board). The case holds the parts without fasteners on the
 * board: the board (with the display), the cell and the LRA are placed by
 * `.protoboard/display.json` and bonded (docs/decisions.md D-W6).
 */
import type { InterfaceLink, ModuleDef } from "@deltarobotics/uhd";
import { budget, TARGETS } from "./power-budget.ts";

/** Battery life and currents, recomputed from the parts by src/power-budget.ts (docs/power-budget.md). */
const B = budget();
const r = (v: number, d = 1) => Number(v.toFixed(d));
const day = (name: string) => r((B.typical.items.find((i) => i.name === name)?.mAhPerDay ?? 0), 2);

const link = (id: string, name: string, a: [string, string], b: [string, string], extra: Partial<InterfaceLink> = {}): InterfaceLink => ({
  id,
  name,
  a: { child: a[0], interfaceId: a[1] },
  b: { child: b[0], interfaceId: b[1] },
  ...extra,
});

export const WEARABLE_WATCH: ModuleDef = {
  id: "wearable-watch",
  name: "Wearable watch",
  kind: "module",
  version: "0.1.0",
  description:
    "Reference smartwatch: Raytac MDBT50Q-1MV2 (nRF52840, BLE), 1.28-inch round 240 x 240 display (ER-TFT1.28-1, GC9A01), BMI270 IMU, MAX30102 heart rate, DRV2605L with a VG0832012 LRA, MAX17048 fuel gauge, MCP73831 charger from USB-C, 200 mAh LiPo (LP402030), two side buttons, printed PETG case with 22 mm spring-bar lugs.",
  tags: ["wearable", "watch", "reference-project", "nrf52840", "ble"],
  display: { icon: "watch" },
  interfaces: [],
  children: [
    { id: "case", moduleDefId: "watch-case", name: "Case" },
    { id: "board", moduleDefId: "watch-main-board", name: "Main board" },
    { id: "cell", moduleDefId: "lipol-lp402030", name: "LiPo cell" },
    { id: "lra", moduleDefId: "vybronics-vg0832012", name: "Haptic LRA" },
    { id: "bar_12", moduleDefId: "esslinger-82-2225-spring-bar", name: "Spring bar (12 o'clock)" },
    { id: "bar_6", moduleDefId: "esslinger-82-2225-spring-bar", name: "Spring bar (6 o'clock)" },
    // harnesses carrying links
    { id: "battery_leads", moduleDefId: "watch-battery-leads", name: "Cell leads" },
    { id: "lra_leads", moduleDefId: "watch-lra-leads", name: "LRA leads" },
    { id: "back_screws", moduleDefId: "watch-back-cover-screws", name: "Back cover screws" },
    // the window covers, cut from PMMA (src/enclosures/watch-case/glazing.uhd.ts)
    { id: "lens", moduleDefId: "watch-display-lens", name: "Display lens" },
    { id: "hr_cover", moduleDefId: "watch-hr-cover", name: "Heart-rate window cover" },
    // assembly materials (src/materials.uhd.ts, D-W6, D-W16)
    { id: "display_ring", moduleDefId: "watch-display-adhesive-ring", name: "Display adhesive ring" },
    { id: "cell_pad", moduleDefId: "watch-cell-foam-pad", name: "Cell foam pad" },
    { id: "lra_pad", moduleDefId: "watch-lra-adhesive-pad", name: "LRA adhesive pad" },
    { id: "cover_adhesive", moduleDefId: "watch-cover-adhesive", name: "Window-cover adhesive" },
  ],
  links: [
    // Cell: its own leads, cut and soldered to J3 (+ to 1). UHD derives the cell's
    // battery output to the board's pads through them.
    {
      id: "cell_leads",
      name: "Cell leads",
      a: { child: "cell", interfaceId: "leads", compose: { p1: "lead_pos", p2: "lead_neg" } },
      b: { child: "battery_leads", interfaceId: "end_cell" },
    },
    {
      id: "cell_pads",
      name: "Cell leads on J3",
      a: { child: "battery_leads", interfaceId: "end_board" },
      b: { child: "board", interfaceId: "cell_pads", compose: { p1: "bat_pos", p2: "bat_neg" } },
    },
    // LRA: its own leads, soldered to J4 (+ to 1)
    {
      id: "lra_wires",
      name: "LRA leads",
      a: { child: "lra", interfaceId: "leads", compose: { p1: "lead_pos", p2: "lead_neg" } },
      b: { child: "lra_leads", interfaceId: "end_lra" },
    },
    {
      id: "lra_pads",
      name: "LRA leads on J4",
      a: { child: "lra_leads", interfaceId: "end_board" },
      b: { child: "board", interfaceId: "lra_pads", compose: { p1: "lra_pos", p2: "lra_neg" } },
    },
    // Window covers: each flush in its window's pocket (the cover's seat frame on the window's outer face)
    link("lens_seat", "Lens in the display window", ["case", "display_window"], ["lens", "seat"]),
    link("hr_cover_seat", "Cover in the heart-rate window", ["case", "hr_window"], ["hr_cover", "seat"]),
    // Back cover: the lid closes on the base with four M2 screws into heat-set inserts. The joint is between two
    // bodies of the case, so it links to itself; the screw harness's fastenerStack places the hardware.
    link("back_cover", "Back cover on the base (4 x M2)", ["case", "back_joint"], ["case", "back_joint"], { harness: "back_screws" }),
    // Strap: a spring bar in each pair of lugs
    link("bar_12_lugs", "Spring bar in the 12 o'clock lugs", ["case", "lugs_12"], ["bar_12", "strap_bar"]),
    link("bar_6_lugs", "Spring bar in the 6 o'clock lugs", ["case", "lugs_6"], ["bar_6", "strap_bar"]),
  ],
  traits: [
    {
      type: "performance",
      params: {
        kind: "battery_life",
        typical_days: r(B.typical.days),
        standby_days: r(B.standby.days, 0),
        typical_mAh_per_day: r(B.typical.mAhPerDay, 2),
        sleep_floor_uA: r(B.floor_uA.total),
        daily_mAh: { sleep_floor: r(B.standby.mAhPerDay, 2), screen_on: day("Screen on"), heart_rate: day("Heart rate"), haptics: day("Haptics") },
        peak_current_mA: r(B.peak.A * 1000, 0),
        // the stack-up's items in power-budget.ts's order
        peak_mA: Object.fromEntries(Object.values(B.peak.items).map((v, i) => [["load_3v0", "backlight", "lra", "hr_vdd", "hr_leds"][i], r(v, 1)])),
        cell_continuous_mA: r(B.cell.continuousA * 1000, 0),
        charge_current_max_mA: r(B.charge.A_max * 1000, 1),
        charge_time_h: r(B.charge.hours, 1),
        targets: { typical_days: TARGETS.typicalDays, standby_days: TARGETS.standbyDays, charge_hours: TARGETS.chargeHours },
        method: "src/power-budget.ts: datasheet currents per component and an assumed daily use profile (docs/power-budget.md); not measured",
        source: "docs/power-budget.md",
      },
    },
    {
      type: "assumption",
      params: {
        field: "battery life",
        value: `${r(B.typical.days)} days typical, ${r(B.standby.days, 0)} days standby`,
        reason: "Estimated from datasheet currents and the use profile in docs/power-budget.md (35 min of screen a day, a 30 s heart-rate reading every 10 minutes, 20 half-second haptic alerts); to be replaced by a measured discharge.",
      },
    },
  ],
};

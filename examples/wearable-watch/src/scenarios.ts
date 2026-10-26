/**
 * Fault scenarios for the wearable watch: each is the system (or its main
 * board) with one realistic mistake and the diagnostic code that must catch
 * it. Not a *.uhd.ts file, so these variants are never loaded as definitions.
 *
 *   npx tsx node_modules/@protoboardai/ext-hardware/skills/system-compose/scripts/scenarios.ts
 *
 * The firmware map has its own faults (swapped SDA and SCL, an unknown wake
 * source, a missing driver property), caught by the firmware check (FW_*);
 * those are in docs/decisions.md D-W14, since this script runs the system
 * checks.
 */
import type { InterfaceLink, ModuleDef } from "@deltarobotics/uhd";
import { netLinks } from "@deltarobotics/uhd";
import { WEARABLE_WATCH } from "./watch.uhd.ts";
import { WATCH_MAIN_BOARD } from "./boards/watch-main/watch-main.uhd.ts";

/** The main board with some membership links moved to another net, removed, or added. */
const board = (id: string, edit: (links: InterfaceLink[]) => InterfaceLink[], children = WATCH_MAIN_BOARD.children): ModuleDef => ({
  ...WATCH_MAIN_BOARD,
  children,
  links: edit(WATCH_MAIN_BOARD.links ?? []),
  description: `${WATCH_MAIN_BOARD.description} (scenario: ${id})`,
});
/** Move pins from one net to another: `<child>:<pin>` members, by membership link id `<net>.<child>.<pin>`. */
const moveTo = (to: string, from: string, members: string[]) => (links: InterfaceLink[]) => [
  ...links.filter((l) => !members.some((m) => l.id === `${from}.${m.replace(":", ".")}`)),
  ...netLinks(to, members),
];
const without = (ids: string[]) => (links: InterfaceLink[]) => links.filter((l) => !ids.some((id) => l.id.startsWith(`${id}.`) || l.id.includes(`.${id}.`)));

/** Re-point positions of a link-scoped composition (a lead soldered to the other pad). */
const recompose = (system: ModuleDef, id: string, side: "a" | "b", patch: Record<string, string>): ModuleDef => ({
  ...system,
  links: (system.links ?? []).map((l) => {
    const end = l[side];
    return l.id === id && "child" in end && end.compose ? { ...l, [side]: { ...end, compose: { ...end.compose, ...patch } } } : l;
  }),
});

export const SCENARIOS = [
  { id: "nominal", label: "Nominal build", expect: [] },
  {
    id: "hr-sensor-on-3v0",
    label: "MAX30102 on the 3.0 V rail",
    description: "The heart-rate sensor's VDD is wired to 3V0 instead of its own 1.8 V LDO (VDD 1.7-2.0 V, 2.2 V absolute maximum).",
    expect: ["UHD_NET"],
    overrides: [board("hr-sensor-on-3v0", moveTo("v3v0", "v1v8", ["u3:pin_11"]))],
  },
  {
    id: "display-on-vbat",
    label: "Display VDD on the cell",
    description: "The display's VDD is wired to VBAT (3.0-4.2 V) instead of 3V0; the panel takes 2.5-3.3 V.",
    expect: ["UHD_NET"],
    overrides: [board("display-on-vbat", moveTo("vbat", "v3v0", ["ds1:pin_4"]))],
  },
  {
    id: "no-i2c-pullups",
    label: "I2C bus without pull-ups",
    description: "R4 and R5 are left off: SDA and SCL have no pull-up, and every device on the bus is open-drain.",
    expect: ["UHD_BUS_PULLUP"],
    overrides: [board("no-i2c-pullups", without(["r4", "r5"]), WATCH_MAIN_BOARD.children?.filter((c) => c.id !== "r4" && c.id !== "r5"))],
  },
  {
    id: "cell-leads-reversed",
    label: "Cell leads soldered the wrong way round",
    description: "The cell's black lead is soldered to J3's + pad and the red lead to the - pad.",
    expect: ["UHD_LINK_STATE"],
    system: recompose(WEARABLE_WATCH, "cell_pads", "b", { p1: "bat_neg", p2: "bat_pos" }),
  },
  {
    id: "ldo-output-to-vbat",
    label: "3V0 LDO output tied to VBAT",
    description: "The 3.0 V regulator's output is wired to the cell rail as well as its input: two outputs drive VBAT.",
    expect: ["UHD_NET"],
    overrides: [board("ldo-output-to-vbat", moveTo("vbat", "v3v0", ["u7:pin_5"]))],
  },
  {
    id: "stat-overdrive",
    label: "Charger STAT straight to the MCU",
    description: "R10/R11 are left off and the MCP73831's STAT goes straight to P0.08: STAT is tri-state and drives high to its VDD (VBUS, 5 V) at charge complete, above the 3 V GPIO's rating (D-W17).",
    expect: ["UHD_NET"],
    overrides: [
      board(
        "stat-overdrive",
        (links) => moveTo("chg_stat", "stat", ["u6:pin_1"])(without(["r10", "r11"])(links)),
        WATCH_MAIN_BOARD.children?.filter((c) => c.id !== "r10" && c.id !== "r11"),
      ),
    ],
  },
];

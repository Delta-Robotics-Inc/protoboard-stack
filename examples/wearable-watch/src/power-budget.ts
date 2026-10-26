/**
 * Battery life, recomputed from docs/power-budget.md's per-component figures
 * and use profile, and checked against the brief's targets (docs/brief.md):
 * typical use >= 5 days, standby (BLE connected, screen off) >= 30 days,
 * charge <= 3.5 h, peak current within the cell's continuous rating.
 *
 * The cell's capacity and ratings come from its part (parts/local), the
 * peak and charge current from the board's cell pads (lands.uhd.ts), so a
 * change there changes the result. The per-component currents are the
 * datasheet figures tabled in docs/power-budget.md (source tags [Wn]); the
 * duty cycles are that document's assumptions.
 *
 *   npx tsx src/power-budget.ts          # prints, writes docs/power-budget.json, exits 1 on a miss
 *
 * Not a *.uhd.ts file: it is a check, not a definition.
 */
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { InterfaceDef, ModuleDef } from "@deltarobotics/uhd";
import { LIPOL_LP402030 } from "../parts/local/lipol-lp402030.uhd.ts";
import { WATCH_CELL_PADS } from "./boards/watch-main/lands.uhd.ts";

const iface = (d: ModuleDef, id: string): InterfaceDef => {
  const i = d.interfaces.find((x) => x.id === id);
  if (!i) throw new Error(`${d.id} has no interface ${id}`);
  return i;
};
const value = (i: InterfaceDef, id: string): number => {
  const p = i.parameters?.find((x) => x.id === id);
  if (typeof p?.value !== "number") throw new Error(`${i.id} states no ${id}`);
  return p.value;
};

/** The brief's targets (docs/brief.md, "Targets"). */
export const TARGETS = { typicalDays: 5, standbyDays: 30, chargeHours: 3.5 };

/** Cell: capacity, usable share (assumption, docs/power-budget.md "Conventions"), continuous and charge ratings. */
const cellOut = iface(LIPOL_LP402030, "battery_out");
const cell = {
  capacitymAh: value(cellOut, "capacity"),
  usable: 0.85,
  continuousA: value(cellOut, "max_current"),
  chargeMaxA: value(iface(LIPOL_LP402030, "charge_in"), "max_current"),
};

/** Sleep floor, µA from VBAT (docs/power-budget.md "Sleep floor"). */
const floor_uA: Record<string, number> = {
  "nRF52840 System ON + LFXO [W2]": 3.16 + 0.23,
  "BLE connection, 3 ms at 6.4 mA per 1 s interval (assumption)": 3e-3 * 6.4e3,
  "Display sleep-in [W3]": 15,
  "BMI270 low-power accel + features [W5]": 10 + 3,
  "DRV2605L shutdown [W7]": 4,
  "MAX17048 hibernate [W9]": 4,
  "MAX30102 shutdown [W6]": 0.7,
  "MCP73831 reverse leakage [W10]": 0.15,
  "Two TPS7A02 ground current [W11]": 2 * 0.025,
};

/** Activities above the floor: mA increment and seconds per day (docs/power-budget.md "Use profile"). */
const cpu = 3.3;
const activities = [
  { name: "Screen on", mA: (8.5 - 0.015) + 10 + 0.3 * cpu, s: 300 * 7 },
  { name: "Heart rate", mA: (0.6 - 0.0007) + 2 * 6.2 * 215e-6 * 50 + 0.05 * cpu, s: 6 * 24 * 30 },
  { name: "Haptics", mA: 0.5 + 58, s: 20 * 0.5 },
];

/**
 * Peak current from VBAT with the firmware limits, as instantaneous currents (docs/power-budget.md "Peak
 * current"): a PWM duty cycle lowers the backlight's average, not the current while it is on, so the
 * backlight counts at (4.2 V - 2.9 V) / 33 Ohm, its full-charge on-current [W3].
 */
const peak_mA: Record<string, number> = {
  "3V0 load: display 10.5 + BLE TX 16.4 + CPU 3.3 + IMU ~1 [W2, W3, W5]": 10.5 + 16.4 + 3.3 + 1,
  "Backlight on-current at 4.2 V through R9 (33 Ohm), PWM on [W3]": ((4.2 - 2.9) / 33) * 1000,
  "LRA drive, DRV2605L at full scale [W7]": 80,
  "MAX30102 VDD [W6]": 1.2,
  "MAX30102 LED pulses, two LEDs at the 12.6 mA firmware cap [W6]": 2 * 12.6,
};

export function budget() {
  const floor = Object.values(floor_uA).reduce((a, b) => a + b, 0);
  const usable = cell.capacitymAh * cell.usable;
  const floorDay = (floor / 1000) * 24;
  const items = activities.map((a) => ({ ...a, mAhPerDay: (a.mA * a.s) / 3600 }));
  const typicalDay = floorDay + items.reduce((a, b) => a + b.mAhPerDay, 0);
  const pads = iface(WATCH_CELL_PADS, "battery_in");
  const peakA = value(pads, "current_draw");
  const chargeA = value(iface(WATCH_CELL_PADS, "charge_out"), "max_current");
  const chargeNominalA = chargeA / 1.1; // the pad states the +10 % limit; nominal = 1000 V / 12 kOhm
  // constant current to about 80 % of capacity, then the taper (assumption: the taper takes about as long again for the last 20 %)
  const chargeHours = (0.8 * cell.capacitymAh) / (chargeNominalA * 1000) + 0.5;
  const result = {
    cell: { ...cell, usablemAh: usable },
    floor_uA: { items: floor_uA, total: floor },
    typical: { items, mAhPerDay: typicalDay, days: usable / typicalDay },
    standby: { mAhPerDay: floorDay, days: usable / floorDay },
    peak: { A: peakA, items: peak_mA, stackUpA: Object.values(peak_mA).reduce((a, b) => a + b, 0) / 1000, cellContinuousA: cell.continuousA },
    charge: { A_max: chargeA, cellChargeMaxA: cell.chargeMaxA, hours: chargeHours },
    targets: TARGETS,
  };
  const checks = [
    { what: `typical use ${result.typical.days.toFixed(1)} days >= ${TARGETS.typicalDays}`, ok: result.typical.days >= TARGETS.typicalDays },
    { what: `standby ${result.standby.days.toFixed(0)} days >= ${TARGETS.standbyDays}`, ok: result.standby.days >= TARGETS.standbyDays },
    { what: `cell pads state ${(peakA * 1000).toFixed(0)} mA >= peak stack-up ${(result.peak.stackUpA * 1000).toFixed(1)} mA`, ok: peakA >= result.peak.stackUpA - 5e-4 },
    { what: `peak ${(peakA * 1000).toFixed(0)} mA <= cell ${(cell.continuousA * 1000).toFixed(0)} mA continuous`, ok: peakA <= cell.continuousA },
    { what: `charge ${(chargeA * 1000).toFixed(1)} mA <= cell ${(cell.chargeMaxA * 1000).toFixed(0)} mA charge`, ok: chargeA <= cell.chargeMaxA },
    { what: `charge time about ${chargeHours.toFixed(1)} h <= ${TARGETS.chargeHours} h`, ok: chargeHours <= TARGETS.chargeHours },
  ];
  return { ...result, checks, pass: checks.every((c) => c.ok) };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const b = budget();
  const out = join(dirname(fileURLToPath(import.meta.url)), "..", "docs", "power-budget.json");
  writeFileSync(out, `${JSON.stringify({ source: "src/power-budget.ts; figures and assumptions in docs/power-budget.md", ...b }, null, 2)}\n`);
  console.log(`floor ${b.floor_uA.total.toFixed(1)} uA; typical ${b.typical.mAhPerDay.toFixed(2)} mAh/day; usable ${b.cell.usablemAh} mAh`);
  for (const c of b.checks) console.log(`${c.ok ? "PASS" : "FAIL"}  ${c.what}`);
  process.exit(b.pass ? 0 : 1);
}

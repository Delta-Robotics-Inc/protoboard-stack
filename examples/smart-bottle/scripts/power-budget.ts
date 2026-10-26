/**
 * The smart bottle's power budget, recomputed from the UHD model and checked
 * against the brief (docs/brief.md: battery life ≥ 30 days sampling every
 * minute with hourly sync; charge time ≤ 5 h).
 *
 *   npx tsx scripts/power-budget.ts [--json]      (exit 1 when a target is missed)
 *
 * Every current is read from the part that states it (the field is named in
 * the output), or, where the part does not state it, taken from the
 * document the part cites, with its source tag from docs/component-selection.md.
 * Board values come from the board's placements: the feedback divider, the
 * LED driver's IREF resistor and the charger's PROG resistor. Duty cycles,
 * converter efficiencies, the usable fraction of the cell and the cut-off are
 * assumptions from docs/power-budget.md, stated in `ASSUME` below. Writes
 * docs/power-budget.json (the figures the documents and the test plan cite)
 * and docs/test-data/battery-life.json (the same estimate as stand-in test
 * data for the datasheet).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ModuleDef } from "@deltarobotics/uhd";
import { loadProject } from "@protoboardai/core";

const json = process.argv.includes("--json");
const p = await loadProject(process.cwd(), { checks: false, extensions: false });
const def = (id: string) => {
  const d = p.lookup(id);
  if (!d) throw new Error(`${id} is not in the project`);
  return d;
};

type Figure = { value: number; unit: string; source: string };
const figures: Record<string, Figure> = {};
const fig = (key: string, value: number, unit: string, source: string) => ((figures[key] = { value, unit, source }), value);

/** A number at a dotted path inside a definition ("domains.0.metadata.x" or "interfaces[wifi].traits[performance].params.y"). */
function at(d: ModuleDef, path: string): number {
  let o: unknown = d;
  for (const seg of path.split(".")) {
    const m = /^(\w+)\[(.+)\]$/.exec(seg);
    if (m) o = ((o as Record<string, unknown>)[m[1]] as { id?: string; type?: string }[]).find((x) => x.id === m[2] || x.type === m[2]);
    else o = (o as Record<string, unknown>)[seg];
  }
  if (typeof o !== "number") throw new Error(`${d.id}: no number at ${path}`);
  return o;
}
const param = (d: ModuleDef, iface: string, id: string) => {
  const v = d.interfaces.find((i) => i.id === iface)?.parameters?.find((x) => x.id === id)?.value;
  if (typeof v !== "number") throw new Error(`${d.id}.${iface}: no parameter ${id}`);
  return v;
};
const fromPart = (key: string, id: string, path: string, scale: number, unit: string) => fig(key, at(def(id), path) * scale, unit, `${id} ${path}`);

// ---------------------------------------------------------------------------
// Assumptions (docs/power-budget.md, "Conventions" and "Activities")
// ---------------------------------------------------------------------------
const ASSUME = {
  usable: 0.85, // of the rated capacity above the 3.40 V cut-off
  vbat: 3.7, // nominal cell voltage
  effActive: 0.9, // buck-boost efficiency, tens to hundreds of mA
  effSleep: 0.7, // in power save, tens of µA
  sample: { awake_s: 0.3, cpu_mA: 25, ranges: 3, range_s: 0.05, probe_s: 0.75 },
  sync: { s: 4, mA: 120 },
  reminder: { s: 3, ledPerLed_mA: 3 },
  targetDays: 30, // brief: battery life
  chargeHoursMax: 5, // brief: charge time
  // charge from empty: constant current until the cell reaches 4.2 V, then the taper to the 7.5 % termination.
  // A LiPo takes about 75 % of its capacity in constant current at 0.3 C, and the taper about 1.5 h (assumption: typical
  // CC/CV curves at this rate; the makers state none for this cell)
  charge: { ccFraction: 0.75, taper_h: 1.5 },
};
const v3 = 3.3;
const toBattActive = (v3v3: number) => (v3v3 * v3) / (ASSUME.vbat * ASSUME.effActive);
const toBattSleep = (v3v3: number) => (v3v3 * v3) / (ASSUME.vbat * ASSUME.effSleep);

// ---------------------------------------------------------------------------
// Part and board facts
// ---------------------------------------------------------------------------
const board = def("bottle-cap-board");
const placed = (id: string) => {
  const c = board.children?.find((x) => x.id === id);
  const r = (c?.overrides as { resistance?: number } | undefined)?.resistance;
  if (typeof r !== "number") throw new Error(`bottle-cap-board ${id}: no resistance override`);
  return r;
};

const capacity = fig("cell_capacity_mAh", param(def("lipol-lp503450"), "battery_out", "capacity"), "mAh", "lipol-lp503450 battery_out.capacity");
const espDeep = fromPart("esp32_deep_sleep_uA", "espressif-esp32-c3-mini-1-h4x", "domains.0.metadata.currents_typ.deep_sleep_rtc_timer_memory_uA", 1, "µA");
const espLight = fromPart("esp32_light_sleep_uA", "espressif-esp32-c3-mini-1-h4x", "domains.0.metadata.currents_typ.light_sleep_uA", 1, "µA");
const wifiTx = fromPart("wifi_tx_peak_mA", "espressif-esp32-c3-mini-1-h4x", "interfaces[wifi].traits[performance].params.current_mA.tx_802_11b_20dBm", 1, "mA");
const wifiRx = fromPart("wifi_rx_mA", "espressif-esp32-c3-mini-1-h4x", "interfaces[wifi].traits[performance].params.current_mA.rx_HT20", 1, "mA");
const tofRange = fig("tof_ranging_mA", param(def("st-vl53l4cdv0dh-1"), "supply", "current_draw") * 1000, "mA", "st-vl53l4cdv0dh-1 supply.current_draw");
const tofPeak = fromPart("tof_peak_mA", "st-vl53l4cdv0dh-1", "domains.0.metadata.supply_current.peak_mA", 1, "mA");
const tofStandby = fig("tof_hw_standby_uA", 5, "µA", "[B3] DS13812 §4.4 Table 12 (HW standby 5 µA typ; not stated on the part)");
const probeActive = fig("ds18b20_active_mA", param(def("adafruit-381-ds18b20-probe"), "wire_vdd", "current_draw") * 1000, "mA", "adafruit-381-ds18b20-probe wire_vdd.current_draw (1.5 mA max)");
const probeStandby = fig("ds18b20_standby_uA", 0.75, "µA", "[B5] DS18B20 DC characteristics (standby 750 nA typ; not stated on the part)");
const tpsQ = fromPart("tps63020_quiescent_uA", "ti-tps63020dsjr", "traits[performance].params.quiescent_current_uA", 1, "µA");
const tpsQout = fig("tps63020_vout_quiescent_uA", 5, "µA", "[B8] SLVS916I §6.5 (5 µA into VOUT; not stated on the part)");
const gauge = fromPart("max17048_hibernate_uA", "adi-max17048g-t10", "domains.0.metadata.supply_current_uA.hibernate_comparator_enabled", 1, "µA");
const ledOff = fig("lp5024_shutdown_uA", 0.2, "µA", "[B6] §6.5 (EN = 0: 0.2 µA typ; in the part's supply usage note)");
const ledNormal = fig("lp5024_normal_mA", param(def("ti-lp5024rsm"), "supply", "current_draw") * 1000, "mA", "ti-lp5024rsm supply.current_draw (normal mode)");
const chgLeak = fig("mcp73831_leakage_uA", 0.15, "µA", "[B10] DS20001984H (battery discharge current, no input: 0.15 µA typ)");

const rTop = placed("r11");
const rBottom = placed("r12");
const vout = fig("buck_boost_vout_V", 0.5 * (1 + rTop / rBottom), "V", `bottle-cap-board r11 ${rTop} Ω / r12 ${rBottom} Ω, VFB 0.5 V ([B8] §8.2.3)`);
const divider = fig("feedback_divider_uA", (vout / (rTop + rBottom)) * 1e6, "µA", "VOUT / (r11 + r12)");
const iset = fig("led_iset_mA", ((105 * 0.7) / placed("r10")) * 1000, "mA", `bottle-cap-board r10 ${placed("r10")} Ω: ISET = 105 × 0.7 V / RIREF ([B6] §7.3.3)`);
const charge = fig("charge_current_mA", (1000 / placed("r13")) * 1000, "mA", `bottle-cap-board r13 ${placed("r13")} Ω: IREG = 1000 V / RPROG ([B10])`);

// ---------------------------------------------------------------------------
// Budget (docs/power-budget.md method)
// ---------------------------------------------------------------------------
const sleep3v3_uA = tpsQout + divider + espDeep + tofStandby + probeStandby;
const sleepBatt_uA = tpsQ + toBattSleep(sleep3v3_uA) + gauge + ledOff + chgLeak;
const mAhPerDay = (uA: number) => (uA * 24) / 1000;

const s = ASSUME.sample;
const sample3v3_mAs = s.awake_s * s.cpu_mA + s.ranges * s.range_s * tofRange + s.probe_s * (probeActive + espLight / 1000);
const sampleBatt_mAs = toBattActive(sample3v3_mAs);
const syncBatt_mAs = toBattActive(ASSUME.sync.s * ASSUME.sync.mA);
const reminderBatt_mAs = ASSUME.reminder.s * (8 * ASSUME.reminder.ledPerLed_mA + ledNormal) + toBattSleep(ASSUME.reminder.s * (espLight / 1000));

const usable = capacity * ASSUME.usable;
const profile = (name: string, samplesPerDay: number, syncsPerDay: number, remindersPerDay: number, syncScale = 1) => {
  const parts = {
    sleep: mAhPerDay(sleepBatt_uA),
    samples: (samplesPerDay * sampleBatt_mAs) / 3600,
    syncs: (syncsPerDay * syncBatt_mAs * syncScale) / 3600,
    reminders: (remindersPerDay * reminderBatt_mAs) / 3600,
  };
  const perDay = Object.values(parts).reduce((a, b) => a + b, 0);
  return { name, samplesPerDay, syncsPerDay, remindersPerDay, mAh_per_day: +perDay.toFixed(2), days: Math.round(usable / perDay), parts: Object.fromEntries(Object.entries(parts).map(([k, v]) => [k, +v.toFixed(3)])) };
};
const profiles = [
  profile("baseline: samples every 5 min, 4 syncs", 288, 4, 16),
  profile("samples every minute, 4 syncs", 1440, 4, 16),
  profile("samples every 5 min, hourly sync", 288, 24, 16),
  profile("target: samples every minute, hourly sync", 1440, 24, 16),
  profile("target with poor Wi-Fi (20 s per sync)", 1440, 24, 16, 5),
];
const target = profiles[3];
const ccHours = (ASSUME.charge.ccFraction * capacity) / charge; // the constant-current phase from empty
const chargeHours = ccHours + ASSUME.charge.taper_h; // plus the constant-voltage taper to termination
// VBAT peak: a Wi-Fi transmission through the buck-boost, with every LED channel at the full scale ISET sets (hardware cap)
const ledMax_mA = 24 * iset;
const vbatPeak = toBattActive(wifiTx) + ledMax_mA + ledNormal;
const vbatMax = fig("cell_discharge_mA", param(def("lipol-lp503450"), "battery_out", "max_current") * 1000, "mA", "lipol-lp503450 battery_out.max_current");

const checks = [
  { id: "battery_life", requirement: `≥ ${ASSUME.targetDays} days, sampling every minute with hourly sync (brief)`, value: `${target.days} days`, pass: target.days >= ASSUME.targetDays },
  { id: "battery_life_poor_wifi", requirement: `≥ ${ASSUME.targetDays} days with 20 s syncs (margin case, docs/power-budget.md)`, value: `${profiles[4].days} days`, pass: profiles[4].days >= ASSUME.targetDays },
  { id: "charge_time", requirement: `≤ ${ASSUME.chargeHoursMax} h from empty (brief)`, value: `${chargeHours.toFixed(1)} h: ${ccHours.toFixed(1)} h constant current (${ASSUME.charge.ccFraction * 100} % of capacity) + ${ASSUME.charge.taper_h} h taper (assumed)`, pass: chargeHours <= ASSUME.chargeHoursMax },
  { id: "charge_current", requirement: "≤ 500 mA (cell's maximum charge current)", value: `${charge.toFixed(0)} mA`, pass: charge <= param(def("lipol-lp503450"), "charge_in", "max_current") * 1000 },
  { id: "buck_boost_vout", requirement: "3.0-3.6 V (ESP32-C3 module supply)", value: `${vout.toFixed(3)} V`, pass: vout >= 3.0 && vout <= 3.6 },
  { id: "led_current", requirement: `reminder assumption ${ASSUME.reminder.ledPerLed_mA} mA per LED ≤ ISET`, value: `ISET ${iset.toFixed(2)} mA`, pass: ASSUME.reminder.ledPerLed_mA <= iset },
  { id: "peak_vbat", requirement: `Wi-Fi TX plus all 24 LED channels at full scale within the cell's ${vbatMax} mA`, value: `${vbatPeak.toFixed(0)} mA (LEDs 24 × ${iset.toFixed(2)} mA = ${ledMax_mA.toFixed(0)} mA, capped by ISET)`, pass: vbatPeak <= vbatMax },
  { id: "peak_3v3", requirement: "Wi-Fi TX peak within the buck-boost's 2 A", value: `${wifiTx} mA (+ ToF ${tofPeak} mA if run together)`, pass: wifiTx + tofPeak <= param(def("ti-tps63020dsjr"), "vout", "max_current") * 1000 },
];

const out = {
  schema: "smart-bottle.power-budget/v0",
  assumptions: ASSUME,
  figures,
  sleep_floor_uA: +sleepBatt_uA.toFixed(1),
  per_activity_mAs: { sample: +sampleBatt_mAs.toFixed(2), sync: +syncBatt_mAs.toFixed(1), reminder: +reminderBatt_mAs.toFixed(1) },
  wifi_rx_mA: wifiRx,
  profiles,
  checks,
};
writeFileSync(join(p.root, "docs/power-budget.json"), JSON.stringify(out, null, 2) + "\n");

// the same estimate as stand-in test data for the documents (uhd-test-data/1): watermarked until measured
const testData = {
  $schema: "uhd-test-data/1",
  status: "standin",
  subject: { system: "smart-bottle", modules: ["lipol-lp503450", "espressif-esp32-c3-mini-1-h4x", "ti-tps63020dsjr"] },
  id: "battery-life",
  title: "Battery-life estimate by use profile",
  conditions: [
    { name: "Capacity", value: capacity, unit: "mAh" },
    { name: "Usable fraction (assumed)", value: ASSUME.usable * 100, unit: "%" },
    { name: "Sleep floor at the cell", value: out.sleep_floor_uA, unit: "µA" },
  ],
  provenance: {
    method: "Stand-in: days = usable capacity ÷ daily charge (sleep floor + samples + syncs + reminders), scripts/power-budget.ts; method and assumptions in docs/power-budget.md.",
    derivedFrom: Object.values(figures).map((f) => f.source).filter((x) => /^[a-z0-9-]+ /.test(x)).map((x) => `def:${x.split(" ")[0]}`).filter((x, i, a) => a.indexOf(x) === i),
    assumptions: [
      `usable capacity ${ASSUME.usable * 100} % of rated; VBAT ${ASSUME.vbat} V; buck-boost efficiency ${ASSUME.effActive * 100} % active, ${ASSUME.effSleep * 100} % asleep`,
      `sample: awake ${ASSUME.sample.awake_s} s at ${ASSUME.sample.cpu_mA} mA, ${ASSUME.sample.ranges} ranges of ${ASSUME.sample.range_s} s, a ${ASSUME.sample.probe_s} s conversion`,
      `sync: ${ASSUME.sync.s} s at ${ASSUME.sync.mA} mA; reminder: ${ASSUME.reminder.s} s, ${ASSUME.reminder.ledPerLed_mA} mA per LED`,
      "self-discharge of the cell not stated by the maker, not included",
    ],
    generator: "examples/smart-bottle/scripts/power-budget.ts",
  },
  columns: [
    { id: "profile", label: "Profile", unit: "" },
    { id: "mah_per_day", label: "Daily charge", unit: "mAh" },
    { id: "days", label: "Battery life", unit: "d" },
  ],
  rows: profiles.map((pr) => [pr.name, pr.mAh_per_day, pr.days]),
  summary: [
    { id: "target_days", label: "Target profile (minute samples, hourly sync)", value: target.days, unit: "d" },
    { id: "baseline_days", label: "Baseline (5 min samples, 4 syncs)", value: profiles[0].days, unit: "d" },
    { id: "sleep_floor_uA", label: "Sleep floor", value: out.sleep_floor_uA, unit: "µA" },
    { id: "charge_h", label: "Charge from empty (constant current and taper)", value: +chargeHours.toFixed(1), unit: "h" },
  ],
};
mkdirSync(join(p.root, "docs/test-data"), { recursive: true });
writeFileSync(join(p.root, "docs/test-data/battery-life.json"), JSON.stringify(testData, null, 2) + "\n");

if (json) console.log(JSON.stringify(out, null, 2));
else {
  console.log(`sleep floor ${out.sleep_floor_uA} µA at the cell; sample ${out.per_activity_mAs.sample} mAs, sync ${out.per_activity_mAs.sync} mAs, reminder ${out.per_activity_mAs.reminder} mAs`);
  for (const pr of profiles) console.log(`  ${pr.name.padEnd(44)} ${String(pr.mAh_per_day).padStart(6)} mAh/day  ${String(pr.days).padStart(4)} days`);
  for (const c of checks) console.log(`${c.pass ? "pass" : "FAIL"}  ${c.id.padEnd(22)} ${c.value}   (${c.requirement})`);
  console.log("→ docs/power-budget.json");
}
process.exitCode = checks.every((c) => c.pass) ? 0 : 1;

/**
 * Firmware fault scenarios for the cap board: board variants with one
 * mistake that the firmware rules must catch (core's checkBoardFirmware, with
 * the ESP-IDF provider's Deep-sleep wake rule). These are the faults UHD's
 * system rules cannot see on this board: the ESP32-C3 routes I2C through its
 * GPIO matrix and states no I2C controller interface, so the bus, its
 * addresses and the pin assignment only exist in the firmware map
 * (src/scenarios.ts has the faults UHD catches).
 *
 *   npx tsx scripts/firmware-scenarios.ts [--json]      (exit 1 when a fault is missed)
 */
import type { InterfaceLink, ModuleDef, ModuleLookup } from "@deltarobotics/uhd";
import { boardFirmware, checkBoardFirmware, loadProject } from "@protoboardai/core";
import { BOTTLE_CAP_BOARD } from "../src/boards/bottle-cap/bottle-cap.uhd.ts";
import FIRMWARE from "../src/boards/bottle-cap/firmware.config.ts";

const json = process.argv.includes("--json");
const p = await loadProject(process.cwd(), { checks: false, extensions: false });

/** Move pins between nets (the board's links are net-to-pin). */
const rewire = (moves: { pin: string; to: string }[]): ModuleDef => ({
  ...BOTTLE_CAP_BOARD,
  links: (BOTTLE_CAP_BOARD.links ?? []).map((l): InterfaceLink => {
    const pin = [l.a, l.b].find((e) => "child" in e);
    const key = pin && "child" in pin ? `${pin.child}:${pin.interfaceId}` : "";
    const mv = moves.find((m) => m.pin === key);
    if (!mv) return l;
    return { ...l, id: `${l.id}_moved`, ...("self" in l.a ? { a: { self: true, interfaceId: mv.to } } : { b: { self: true, interfaceId: mv.to } }) };
  }),
});

/** The LP5024 strapped for another address (ADDR0 to VCC: 0x29, [B6] Table 7-2). */
const lp5024 = p.lookup("ti-lp5024rsm")!;
const lp5024At0x29: ModuleDef = {
  ...lp5024,
  interfaces: lp5024.interfaces.map((i) => (i.id === "i2c" ? { ...i, parameters: i.parameters?.map((x) => (x.id === "i2c_address" ? { ...x, value: 0x29 } : x)) } : i)),
};

const wakeRule = { sleepName: "Deep-sleep", canWake: (leaf: { capabilities?: string[] }) => (leaf.capabilities ?? []).includes("deep_sleep_wakeup") };
const baseWake = (FIRMWARE as { constraints?: { wake?: string[] } }).constraints?.wake;

const SCENARIOS: { id: string; label: string; expect: string[]; board?: ModuleDef; parts?: ModuleDef[]; wake?: string[] }[] = [
  { id: "nominal", label: "Nominal board", expect: [] },
  { id: "lp5024-at-0x29", label: "LED driver strapped to 0x29, the ToF sensor's address", expect: ["FW_I2C_ADDRESS_CONFLICT"], parts: [lp5024At0x29] },
  { id: "wake-on-gauge-alert", label: "Fuel-gauge alert (GPIO6) as a Deep-sleep wake source", expect: ["FW_WAKE_INVALID"], wake: ["sw1", "u6"] },
  { id: "tof-int-on-gpio9", label: "ToF interrupt on GPIO9, the BOOT strapping pin", expect: ["FW_STRAPPING_DRIVEN"], board: rewire([{ pin: "u2:pin_7", to: "boot" }]) },
  { id: "led-en-on-button", label: "LED driver enable on the button's GPIO3", expect: ["FW_PIN_REUSED"], board: rewire([{ pin: "u3:pin_30", to: "btn" }]) },
];

const results = SCENARIOS.map((s) => {
  const parts = new Map((s.parts ?? []).map((d) => [d.id, d]));
  const lookup: ModuleLookup = (id) => parts.get(id) ?? p.lookup(id);
  const fw = boardFirmware(s.board ?? BOTTLE_CAP_BOARD, lookup);
  const findings = checkBoardFirmware(fw, lookup, { ...wakeRule, wake: s.wake ?? baseWake });
  const raised = findings.filter((f) => f.severity !== "info");
  const missed = s.expect.filter((c) => !raised.some((f) => f.code === c));
  const errors = findings.filter((f) => f.severity === "error");
  const ok = s.expect.length ? missed.length === 0 : errors.length === 0;
  return { id: s.id, label: s.label, expect: s.expect, ok, missed, raised: raised.map((f) => `${f.severity} ${f.code}: ${f.message}`) };
});

if (json) console.log(JSON.stringify(results, null, 2));
else
  for (const r of results) {
    console.log(`${r.ok ? "caught " : "MISSED "} ${r.id.padEnd(22)} ${r.label}`);
    for (const line of r.raised.filter((l) => (r.expect.length ? r.expect.some((c) => l.includes(c)) : l.startsWith("error")))) console.log(`         ${line.slice(0, 200)}`);
  }
process.exitCode = results.every((r) => r.ok) ? 0 : 1;

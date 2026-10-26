/**
 * Category hints (PB-864): a part is filed under every category that fits.
 * The heuristic over tags, interfaces and the part's own categories, and the
 * cloud part library held to it.
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { ModuleDef } from "@deltarobotics/uhd";
import { BrushedMotorTerminals, Ground, PowerIn, QuadratureEncoder, StepperPhases, defineModule } from "@deltarobotics/uhd";
import { categoryHintMessages, categoryHints } from "../lib/categories.ts";
import { loadParts } from "../lib/layout.ts";
import { cloudCheckout } from "../../core/test/cloud-checkout.ts";

const part = (over: Partial<ModuleDef>): ModuleDef =>
  defineModule({ id: "p", name: "p", interfaces: [PowerIn({ id: "vin", voltageV: 5 }), Ground()], ...over } as ModuleDef);
const hints = (def: ModuleDef) => categoryHints(def).map((h) => h.path);

describe("category hints", () => {
  it("a breakout that carries a sensor also gets the sensor category, and the reverse", () => {
    expect(hints(part({ categories: ["expansion.breakout"], tags: ["imu", "i2c"] }))).toEqual(["sensor.motion"]);
    expect(hints(part({ categories: ["sensor.distance"], tags: ["tof", "breakout"] }))).toEqual(["expansion.breakout"]);
    expect(hints(part({ categories: ["sensor.distance", "expansion.breakout"], tags: ["tof", "breakout"] }))).toEqual([]);
  });

  it("a board form with no hint of what it carries still gets a warning", () => {
    expect(categoryHintMessages(part({ categories: ["expansion.arduino_shield"], tags: ["shield"] }))).toEqual([
      "filed only under expansion.arduino_shield: also list the category of what the board carries (a sensor breakout is also sensor.<kind>)",
    ]);
  });

  it("platform tags point at robotics categories; a covered path or a path below it counts", () => {
    expect(hints(part({ categories: ["actuator.motor.servo"], tags: ["frc", "ftc"] }))).toEqual(["robotics.frc", "robotics.ftc"]);
    expect(hints(part({ categories: ["actuator.motor.servo", "robotics"], tags: ["frc"] }))).toEqual(["robotics.frc"]);
    expect(hints(part({ categories: ["sensor.motion", "robotics.frc"], tags: ["frc"] }))).toEqual([]);
  });

  it("interfaces point at categories: an encoder output, a motor driver output, stepper windings", () => {
    expect(hints(part({ categories: ["actuator.motor.dc_motor"], interfaces: [...QuadratureEncoder({ role: "output", a: { pin: "A" }, b: { pin: "B" } })] }))).toEqual(["sensor.encoder"]);
    expect(hints(part({ categories: ["component.ic"], interfaces: [...BrushedMotorTerminals({ role: "output" })] }))).toEqual(["actuator.motor_controller"]);
    expect(hints(part({ categories: ["robotics.educational"], interfaces: [...StepperPhases({ role: "input", winding: "bipolar" })] }))).toEqual(["actuator.motor.stepper"]);
    // reading an encoder does not make a part an encoder
    expect(hints(part({ categories: ["actuator.motor_controller"], interfaces: [...QuadratureEncoder({ role: "input", a: { pin: "A" }, b: { pin: "B" } })] }))).toEqual([]);
  });

  it("a pass-through part (its own links join its interfaces) is not what it carries", () => {
    const encoderOut = QuadratureEncoder({ role: "output", a: { pin: "A" }, b: { pin: "B" } });
    const links = [{ from: { module: "self", interface: "vin" }, to: { module: "self", interface: "gnd" } }] as unknown as ModuleDef["links"];
    // a cable tagged "encoder" and carrying an encoder output is not an encoder; its platform tag still counts
    expect(hints(part({ categories: ["connector.cable"], tags: ["encoder", "tft", "ftc"], interfaces: [...encoderOut], links }))).toEqual(["robotics.ftc"]);
    // without links the same data does point at the categories
    expect(hints(part({ categories: ["connector.cable"], tags: ["encoder", "tft"], interfaces: [...encoderOut] }))).toEqual(["sensor.encoder", "component.display"]);
  });

  it("memory tags on a sensor or a dev board, and an SSD tag on a PCIe carrier, are features, not what the part is", () => {
    expect(hints(part({ categories: ["sensor.environmental", "component.ic"], tags: ["eeprom"] }))).toEqual([]);
    expect(hints(part({ categories: ["microcontroller.development_board"], tags: ["psram"] }))).toEqual([]);
    expect(hints(part({ categories: ["expansion.pi_hat", "expansion.pcie", "connector.signal_connector"], tags: ["ssd"] }))).toEqual([]);
    expect(hints(part({ categories: ["component.ic"], tags: ["fram"] }))).toEqual(["component.storage.memory"]);
  });

  it("generic passives take no hints from tags that say where they are used", () => {
    expect(hints(part({ categories: ["component.passive.capacitor"], tags: ["esc", "fpv", "drone"] }))).toEqual([]);
    expect(hints(part({ categories: ["mechanical.fastener.screw"], tags: ["fpv"] }))).toEqual([]);
  });

  it("forms: a bare IC, a development board; a microcontroller chip is not also component.ic", () => {
    expect(hints(part({ categories: ["power.regulator"], tags: ["ldo", "ic"] }))).toEqual(["component.ic"]);
    expect(hints(part({ categories: ["microcontroller.chip", "microcontroller.esp32"], tags: ["ic", "soc"] }))).toEqual([]);
    expect(hints(part({ categories: ["microcontroller.arduino"], tags: ["dev-board"] }))).toEqual(["microcontroller.development_board"]);
  });

  it("a drone motor, battery or ESC is RC hobby stock; a drone frame part is not", () => {
    expect(hints(part({ categories: ["actuator.motor.brushless", "robotics.drone"] }))).toEqual(["robotics.rc"]);
    expect(hints(part({ categories: ["power.battery", "robotics.drone"] }))).toEqual(["robotics.rc"]);
    expect(hints(part({ categories: ["mechanical.propeller", "robotics.drone"] }))).toEqual([]);
  });

  it("kit manifests: a listed part is filed under the kit, and a part filed under a kit is listed", () => {
    const kits = new Map([["kit.freenove_fnk0082", new Set(["p"])]]);
    expect(categoryHints(part({ categories: ["actuator.motor.servo"] }), undefined, { kits }).map((h) => h.path)).toEqual(["kit.freenove_fnk0082"]);
    expect(categoryHints(part({ categories: ["actuator.motor.servo", "kit.freenove_fnk0082"] }), undefined, { kits })).toEqual([]);
    expect(categoryHintMessages(part({ id: "q", categories: ["actuator.motor.servo", "kit.freenove_fnk0082"] }), undefined, { kits })).toEqual([
      "filed under kit.freenove_fnk0082, but the kit's manifest (library/kits) does not list it: add it to the manifest or drop the category",
    ]);
    // without manifests, kits are not checked
    expect(hints(part({ categories: ["actuator.motor.servo", "kit.freenove_fnk0082"] }))).toEqual([]);
  });

  it("the message says when the part has a single category", () => {
    expect(categoryHintMessages(part({ categories: ["sensor.distance"], tags: ["breakout"] }))).toEqual([
      'filed under one category (sensor.distance); also fits expansion.breakout (tag "breakout"); list every category that fits',
    ]);
  });
});

/**
 * Hints the library's authors reviewed and declined, with the reason in the
 * part's own header (protoboard-cloud library/parts/<id>.ts). Exact messages:
 * a new or changed hint on these parts is reported again. PB-809: the PB-866
 * migration added both; this repository does not edit library parts.
 */
const DECLINED_HINTS = new Set([
  // "Not component.display, which verify-part suggests from the "tft" tag: the board carries display lines but is no display"
  'adafruit-eyespi-breakout: also fits component.display (tag "tft"); list every category that fits',
  // "expansion.breakout is carried over by the owner rule although a breadboard is not a breakout board; the taxonomy has no prototyping node"
  "generic-breadboard-830: filed only under expansion.breakout: also list the category of what the board carries (a sensor breakout is also sensor.<kind>)",
]);

describe("the cloud part library", () => {
  // The library of a protoboard-cloud checkout (PROTOBOARD_CLOUD_DIR, else ../protoboard-cloud; skipped without
  // one). The check needs a library retagged for PB-864: UHD taxonomy 1.1.0 or later and kit manifests
  // (library/kits). An older checkout is skipped, so this repository and protoboard-cloud can merge in either order.
  const CLOUD = cloudCheckout() ?? join(dirname(fileURLToPath(import.meta.url)), "no-protoboard-cloud");
  const declared = (() => {
    try {
      return (JSON.parse(readFileSync(join(CLOUD, "library/taxonomy.json"), "utf8")) as { taxonomy?: { version?: string } }).taxonomy?.version ?? "0";
    } catch {
      return "0";
    }
  })();
  const [major, minor] = declared.split(".").map(Number);
  const retagged = (major > 1 || (major === 1 && minor >= 1)) && existsSync(join(CLOUD, "library/kits"));

  it.skipIf(!retagged)("files every part under every category its data points at, kits included", async () => {
    const set = await loadParts(CLOUD);
    expect(set.defs.size).toBeGreaterThanOrEqual(92);
    expect(set.kits?.get("kit.freenove_fnk0082")?.size).toBeGreaterThanOrEqual(5);
    const open = [...set.defs.values()].flatMap((d) => categoryHintMessages(d, set.taxonomy, { kits: set.kits }).map((m) => `${d.id}: ${m}`));
    expect(open.filter((m) => !DECLINED_HINTS.has(m))).toEqual([]);
  });
});

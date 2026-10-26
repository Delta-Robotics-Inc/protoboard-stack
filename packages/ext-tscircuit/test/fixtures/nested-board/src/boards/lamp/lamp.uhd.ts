/**
 * TEST FIXTURE: a grouped board (docs/specs/nested-boards.md). The lamp board
 * holds its connector and controller, and three kinds of sub-module:
 *
 *   power    kind "group" (no interfaces of its own): an LDO and its two
 *            capacitors, wired entirely by the board through the group's
 *            implicit exports (`ldo__pin_1`, `cin__pin_2`, …)
 *   sensor   a module with its own nets (vdd, gnd, sda, scl: the pull-ups and
 *            decoupling stay inside) and declared exports: one pin per rail the
 *            board joins (`<net>_port`: an export cannot share its module's net
 *            id), and the sensor's I2C port, which the board links to the
 *            controller's: the bus crosses the boundary as one link, paired
 *            line by line by UHD (a pin bound into a composite is not on the
 *            boundary, so SDA cannot be exported on its own)
 *   led1/2   one definition used twice: two sets of parts, two designators
 *            each, two pairs of inner nets (led1:a, led2:a), joined to the
 *            board's v5 and gnd through exported pins
 *
 * Not a design to build: the parts are the fixture's (parts.uhd.ts).
 */
import { Net, defineModule, netLinks, type ModuleDef } from "@deltarobotics/uhd";

/** Power stage: an organisational group, wired by its parent. */
export const POWER_STAGE: ModuleDef = defineModule({
  id: "fx-power-stage",
  name: "Power stage",
  kind: "group",
  interfaces: [],
  children: [
    { id: "ldo", moduleDefId: "fx-ldo-3v3-sot23-5" },
    { id: "cin", moduleDefId: "fx-c-1u-0402", name: "LDO input capacitor" },
    { id: "cout", moduleDefId: "fx-c-1u-0402", name: "LDO output capacitor" },
  ],
});

/** Sensor: its pull-ups and decoupling on its own nets; one exported pin per net the board joins. */
export const SENSOR_MODULE: ModuleDef = defineModule({
  id: "fx-sensor-module",
  name: "Sensor",
  interfaces: [Net({ id: "vdd", name: "VDD", voltageV: 3.3 }), Net({ id: "gnd", name: "GND" }), Net({ id: "sda", name: "SDA" }), Net({ id: "scl", name: "SCL" })],
  children: [
    { id: "s1", moduleDefId: "fx-i2c-sensor-sot23-5" },
    { id: "r1", moduleDefId: "fx-r-4k7-0402", name: "SDA pull-up" },
    { id: "r2", moduleDefId: "fx-r-4k7-0402", name: "SCL pull-up" },
    { id: "c1", moduleDefId: "fx-c-100n-0402", name: "Sensor decoupling" },
  ],
  links: [
    ...netLinks("vdd", ["s1:pin_1", "c1:pin_1", "r1:pin_1", "r2:pin_1"]),
    ...netLinks("gnd", ["s1:pin_2", "c1:pin_2"]),
    ...netLinks("sda", ["s1:pin_3", "r1:pin_2"]),
    ...netLinks("scl", ["s1:pin_4", "r2:pin_2"]),
  ],
  exports: [
    { id: "vdd_port", name: "VDD", from: { child: "s1", interfaceId: "pin_1" } },
    { id: "gnd_port", name: "GND", from: { child: "s1", interfaceId: "pin_2" } },
    { id: "i2c", name: "I2C", from: { child: "s1", interfaceId: "i2c" } },
    { id: "int", name: "INT", from: { child: "s1", interfaceId: "pin_5" } },
  ],
});

/** One LED channel: a low-side switch, its gate pull-down, the LED and its resistor. Used twice. */
export const LED_CHANNEL: ModuleDef = defineModule({
  id: "fx-led-channel",
  name: "LED channel",
  interfaces: [Net({ id: "a", name: "A" }), Net({ id: "k", name: "K" }), Net({ id: "g", name: "G" }), Net({ id: "gnd", name: "GND" })],
  children: [
    { id: "q1", moduleDefId: "fx-nmos-sot23" },
    { id: "d1", moduleDefId: "fx-led-white-0603" },
    { id: "r1", moduleDefId: "fx-r-150-0402", name: "LED resistor" },
    { id: "r2", moduleDefId: "fx-r-100k-0402", name: "Gate pull-down" },
  ],
  links: [
    ...netLinks("a", ["r1:pin_2", "d1:anode"]),
    ...netLinks("k", ["d1:cathode", "q1:pin_3"]),
    ...netLinks("g", ["q1:pin_1", "r2:pin_1"]),
    ...netLinks("gnd", ["q1:pin_2", "r2:pin_2"]),
  ],
  exports: [
    { id: "vled", name: "LED supply", from: { child: "r1", interfaceId: "pin_1" } },
    { id: "ctl", name: "Control", from: { child: "q1", interfaceId: "pin_1" } },
    { id: "gnd_port", name: "GND", from: { child: "q1", interfaceId: "pin_2" } },
  ],
});

export const LAMP_BOARD: ModuleDef = defineModule({
  id: "fx-lamp-board",
  name: "Lamp board (test fixture)",
  description: "A controller reading an I2C sensor and switching two LED channels, 3.3 V from an LDO. Grouped: power, sensor, led1, led2.",
  interfaces: [
    Net({ id: "v5", name: "5V", voltageV: 5 }),
    Net({ id: "v3v3", name: "3V3", voltageV: 3.3 }),
    Net({ id: "gnd", name: "GND" }),
    Net({ id: "int", name: "INT" }),
    Net({ id: "led1_ctl", name: "LED1" }),
    Net({ id: "led2_ctl", name: "LED2" }),
  ],
  children: [
    { id: "j1", moduleDefId: "fx-jst-sh4" },
    { id: "u1", moduleDefId: "fx-controller-soic8" },
    { id: "power", moduleDefId: "fx-power-stage" },
    { id: "sensor", moduleDefId: "fx-sensor-module" },
    { id: "led1", moduleDefId: "fx-led-channel", name: "LED channel 1" },
    { id: "led2", moduleDefId: "fx-led-channel", name: "LED channel 2" },
  ],
  links: [
    ...netLinks("v5", ["j1:pin_1", "power:ldo__pin_1", "power:ldo__pin_3", "power:cin__pin_1", "led1:vled", "led2:vled"]),
    ...netLinks("v3v3", ["power:ldo__pin_5", "power:cout__pin_1", "u1:pin_1", "sensor:vdd_port"]),
    ...netLinks("gnd", ["j1:pin_4", "power:ldo__pin_2", "power:cin__pin_2", "power:cout__pin_2", "u1:pin_8", "sensor:gnd_port", "led1:gnd_port", "led2:gnd_port"]),
    ...netLinks("int", ["u1:pin_6", "sensor:int"]),
    ...netLinks("led1_ctl", ["u1:pin_4", "led1:ctl"]),
    ...netLinks("led2_ctl", ["u1:pin_5", "led2:ctl"]),
    // the I2C bus crosses into the sensor intact: a direct link between the two ports, paired line by line by UHD
    { id: "i2c_bus", a: { child: "u1", interfaceId: "i2c0" }, b: { child: "sensor", interfaceId: "i2c" } },
  ],
  exports: [{ id: "power_in", name: "Power in", from: { child: "j1", interfaceId: "port" } }],
});

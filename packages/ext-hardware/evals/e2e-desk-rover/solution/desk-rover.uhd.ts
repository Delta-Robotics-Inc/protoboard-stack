import type { InterfaceLink, ModuleDef } from "@deltarobotics/uhd";

/**
 * Desk rover sensor bench (docs/brief.md): an Arduino UNO R3 with the
 * Adafruit Motor Shield V2 stacked on its headers, and a VL53L4CD breakout
 * on the shared I2C bus, powered from the UNO's 5 V pin. Powered from the
 * UNO's USB port (R5); the UNO's VIN and DC jack and the shield's VIN and
 * motor terminal are marked unconnected on purpose (R5), so check reports
 * them as info and the test plan does not power them.
 */
const link = (id: string, name: string, a: [string, string], b: [string, string], extra: Partial<InterfaceLink> = {}): InterfaceLink => ({
  id,
  name,
  a: { child: a[0], interfaceId: a[1] },
  b: { child: b[0], interfaceId: b[1] },
  ...extra,
});

export const DESK_ROVER: ModuleDef = {
  id: "desk-rover",
  name: "Desk rover sensor bench",
  kind: "module",
  version: "0.1.0",
  description: "Arduino UNO R3 with an Adafruit Motor Shield V2 stacked on it and an Adafruit VL53L4CD time-of-flight breakout on the I2C bus; a desk rig for the rover's obstacle detection.",
  interfaces: [],
  children: [
    {
      id: "uno",
      moduleDefId: "arduino-uno-rev3",
      name: "Arduino UNO R3",
      unconnected: [
        { interfaceId: "vin", reason: "the bench runs from the UNO's USB port (R5)" },
        { interfaceId: "dc_jack", reason: "the bench runs from the UNO's USB port (R5)" },
      ],
    },
    {
      id: "shield",
      moduleDefId: "adafruit-1438-motor-shield-v2",
      name: "Motor shield",
      unconnected: [
        { interfaceId: "arduino_vin", reason: "VIN jumper not fitted: the motors get their own supply" },
        { interfaceId: "vmotor_in", reason: "stays unconnected until the rover's battery is chosen (R5)" },
      ],
    },
    { id: "tof", moduleDefId: "adafruit-5396-vl53l4cd", name: "ToF sensor" },
  ],
  links: [
    // R1: the shield stacks on the UNO's headers (11 mm stack height assumed, as in examples/uno-motor-bench)
    link("shield_mount", "Shield on the UNO's headers", ["uno", "mount"], ["shield", "mount"], { mate: { gapMm: 11 } }),
    link("shield_i2c", "Shield I2C", ["uno", "i2c"], ["shield", "i2c"]),
    // R2: the shield's logic power from the UNO's headers
    link("shield_5v", "Shield 5V", ["uno", "5v"], ["shield", "arduino_5v"]),
    link("shield_ioref", "Shield IOREF", ["uno", "ioref"], ["shield", "arduino_ioref"]),
    link("shield_gnd", "Shield GND", ["uno", "gnd_1"], ["shield", "arduino_gnd"]),
    // R3: the sensor on the I2C bus, 5 V from the UNO, common ground
    link("tof_i2c", "ToF I2C", ["uno", "i2c"], ["tof", "i2c"]),
    link("tof_power", "ToF 5V", ["uno", "5v"], ["tof", "vin"]),
    link("tof_gnd", "ToF GND", ["uno", "gnd_2"], ["tof", "gnd"]),
  ],
};

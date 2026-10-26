import type { ModuleDef } from "@deltarobotics/uhd";

/**
 * A small robotics bench: an Arduino UNO R3 with the Adafruit Motor Shield V2
 * stacked on it, and a VL53L4CD time-of-flight sensor on the shared I2C bus.
 * All three parts come from the catalog (parts/catalog). A second, non-quad
 * fixture for the viewer contract (PB-800).
 */
export const UNO_MOTOR_BENCH: ModuleDef = {
  id: "uno-motor-bench",
  name: "UNO motor bench",
  kind: "module",
  interfaces: [],
  children: [
    { id: "uno", moduleDefId: "arduino-uno-rev3", name: "Arduino UNO R3" },
    { id: "shield", moduleDefId: "adafruit-1438-motor-shield-v2", name: "Motor shield" },
    { id: "tof", moduleDefId: "adafruit-5396-vl53l4cd", name: "ToF sensor" },
  ],
  links: [
    // the shield stacks on the UNO's headers (assumed 11 mm header stack height)
    { id: "shield_mount", name: "Shield on UNO", a: { child: "uno", interfaceId: "mount" }, b: { child: "shield", interfaceId: "mount" }, mate: { gapMm: 11 } },
    { id: "shield_i2c", name: "Shield I2C", a: { child: "uno", interfaceId: "i2c" }, b: { child: "shield", interfaceId: "i2c" } },
    { id: "tof_i2c", name: "ToF I2C", a: { child: "uno", interfaceId: "i2c" }, b: { child: "tof", interfaceId: "i2c" } },
    { id: "tof_power", name: "ToF 5V", a: { child: "uno", interfaceId: "5v" }, b: { child: "tof", interfaceId: "vin" } },
    { id: "tof_gnd", name: "ToF GND", a: { child: "uno", interfaceId: "gnd_1" }, b: { child: "tof", interfaceId: "gnd" } },
  ],
};

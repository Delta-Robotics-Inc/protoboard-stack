import type { ModuleDef } from "@deltarobotics/uhd";

/** EVAL FIXTURE: the system that uses the regulator (fictional). */
export const SENSOR_NODE: ModuleDef = {
  id: "sensor-node",
  name: "Sensor node",
  kind: "module",
  interfaces: [],
  children: [{ id: "ldo", moduleDefId: "acme-ldo3300-33" }],
  links: [],
};

import type { ModuleDef } from "@deltarobotics/uhd";

/** EVAL FIXTURE: the system around the regulator being sourced (fictional). */
export const SENSOR_NODE: ModuleDef = {
  id: "sensor-node",
  name: "Sensor node",
  kind: "module",
  interfaces: [],
  children: [{ id: "ldo", moduleDefId: "acme-ldo3300-33", quantity: 2 }],
  links: [],
};

import type { ModuleDef } from "@deltarobotics/uhd";

/** TEST FIXTURE: a sensor on a controller. */
export const SENSOR: ModuleDef = { id: "demo-sensor", name: "Demo sensor", interfaces: [] };
export const RIG: ModuleDef = {
  id: "demo-rig",
  name: "Demo rig",
  interfaces: [],
  children: [{ id: "sensor", moduleDefId: "demo-sensor" }],
  links: [],
};

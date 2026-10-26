import type { ModuleDef } from "@deltarobotics/uhd";

/** TEST FIXTURE: a system holding one custom board, so the board has an instance path. */
export const WATCH: ModuleDef = {
  id: "watch-core",
  name: "Watch core (test fixture)",
  interfaces: [],
  children: [{ id: "mainboard", moduleDefId: "watch-core-board", name: "Watch mainboard" }],
};

import type { ModuleDef } from "@deltarobotics/uhd";

/** TEST FIXTURE: a system holding one custom board, so the board has an instance path. */
export const BOTTLE: ModuleDef = {
  id: "bottle-core",
  name: "Bottle core (test fixture)",
  interfaces: [],
  children: [{ id: "mainboard", moduleDefId: "bottle-core-board", name: "Bottle cap board" }],
};

import type { ModuleDef } from "@deltarobotics/uhd";

/** TEST FIXTURE: a system holding the grouped lamp board, so the board has an instance path. */
export const LAMP: ModuleDef = {
  id: "fx-lamp",
  name: "Two-channel lamp (test fixture)",
  interfaces: [],
  children: [{ id: "board", moduleDefId: "fx-lamp-board", name: "Lamp board" }],
};

import type { ModuleDef } from "@deltarobotics/uhd";

/** TEST FIXTURE: a system holding one custom board, so the board has an instance path. */
export const TILE: ModuleDef = {
  id: "imu-tile",
  name: "IMU tile (test fixture)",
  interfaces: [],
  children: [{ id: "board", moduleDefId: "imu-tile-board", name: "IMU tile board" }],
};

import { defineCapabilityConfig } from "@protoboardai/core";

// TEST FIXTURE: Zephyr for the watch core board.
export default defineCapabilityConfig({
  provider: "@protoboardai/ext-zephyr",
  constraints: {
    board_name: "watch_core",
    // the side button and the fuel gauge's alert wake the watch from System OFF
    wake: ["sw1", "u3"],
    // the DRV2605L drives an LRA (Vybronics VG0832012 in the watch); its binding requires the mode
    properties: { u5: { "actuator-mode": "LRA" } },
  },
});

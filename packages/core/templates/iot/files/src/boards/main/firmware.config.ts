import { defineCapabilityConfig } from "@protoboardai/core";

/**
 * The main board's firmware configuration provider (@protoboardai/ext-esp-idf): ESP-IDF pin header
 * (board_pins.h) and sdkconfig.defaults for the ESP32-C3-MINI-1, written by `protoboard run
 * firmware:generate --module main-board`, every line citing the board's nets and parts. The console
 * is USB Serial/JTAG (GPIO18/19 reach the USB-C receptacle). Wake sources go in `constraints.wake`
 * once the board has a button or a sensor interrupt (see smart-bottle's firmware.config.ts).
 */
export default defineCapabilityConfig({
  provider: "@protoboardai/ext-esp-idf",
  module: "main-board",
});

import { defineCapabilityConfig } from "@protoboardai/core";

/**
 * The cap board's firmware configuration provider: ESP-IDF 5.3 for the
 * ESP32-C3-MINI-1 (board_pins.h and sdkconfig.defaults in esp-idf/, standard
 * outputs in out/config/ and out/firmware.manifest.json).
 *
 * Wake from Deep-sleep: the button (sw1, GPIO3, an RTC pad [B2]). The
 * timer wakes the cap for each sample (docs/power-budget.md); the ToF sensor
 * is in hardware standby while the chip sleeps (XSHUT held low) and the fuel
 * gauge's alert is on GPIO6, which cannot wake the chip, so neither is a
 * wake source. The console is USB Serial/JTAG (the default: GPIO18/19 reach
 * the USB-C receptacle).
 */
export default defineCapabilityConfig({
  provider: "@protoboardai/ext-esp-idf",
  constraints: { wake: ["sw1"] },
});

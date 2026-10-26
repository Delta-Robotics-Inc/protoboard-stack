/**
 * The firmware capability for ESP-IDF on ESP32-C3 modules: the shared
 * operations from @protoboardai/core with this provider's design, pin reader
 * and wake rule (Deep-sleep wake only from RTC GPIOs).
 */
import type { CapabilityOperationFn } from "@protoboardai/core";
import { firmwareOperations, type FirmwareProviderSpec } from "@protoboardai/core";
import { designEspIdf } from "../lib/design.ts";
import { readEspIdfPins } from "../lib/pins.ts";
import { IDF_VERSION } from "../lib/soc.ts";

export const SPEC: FirmwareProviderSpec = {
  provider: "@protoboardai/ext-esp-idf",
  framework: "esp-idf",
  frameworkVersion: IDF_VERSION,
  design: designEspIdf,
  readPins: readEspIdfPins,
  // only RTC IO (GPIO0-5 on the ESP32-C3) wake it from Deep-sleep: the part marks them deep_sleep_wakeup
  rules: () => ({ sleepName: "Deep-sleep", canWake: (leaf) => (leaf.capabilities ?? []).includes("deep_sleep_wakeup") }),
};

const ops = firmwareOperations(SPEC);
export const generate: CapabilityOperationFn = ops.generate;
export const exportOutputs: CapabilityOperationFn = ops.exportOutputs;
export const extract: CapabilityOperationFn = ops.extract;
export const check: CapabilityOperationFn = ops.check;

import { defineCapabilityConfig } from "@protoboardai/core";

// Routed geometry of the watch-battery-leads harness (@protoboardai/ext-harness-cad): route in harness-cad/, bodies in out/.
export default defineCapabilityConfig({ provider: "@protoboardai/ext-harness-cad", module: "watch-battery-leads" });

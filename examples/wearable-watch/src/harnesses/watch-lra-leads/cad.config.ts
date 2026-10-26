import { defineCapabilityConfig } from "@protoboardai/core";

// Routed geometry of the watch-lra-leads harness (@protoboardai/ext-harness-cad): route in harness-cad/, bodies in out/.
export default defineCapabilityConfig({ provider: "@protoboardai/ext-harness-cad", module: "watch-lra-leads" });

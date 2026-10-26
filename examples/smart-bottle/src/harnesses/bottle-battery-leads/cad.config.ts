import { defineCapabilityConfig } from "@protoboardai/core";

// The routed geometry of bottle-battery-leads (ext-harness-cad): route in harness-cad/, bodies in out/.
export default defineCapabilityConfig({ provider: "@protoboardai/ext-harness-cad", module: "bottle-battery-leads" });

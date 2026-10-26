import { defineCapabilityConfig } from "@protoboardai/core";

// The routed geometry of bottle-probe-cable (ext-harness-cad): route in harness-cad/, bodies in out/.
export default defineCapabilityConfig({ provider: "@protoboardai/ext-harness-cad", module: "bottle-probe-cable" });

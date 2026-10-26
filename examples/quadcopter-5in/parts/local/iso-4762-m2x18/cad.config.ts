/**
 * iso-4762-m2x18's `cad` provider (tool-integrations §4): its nominal body from its
 * sizes (@protoboardai/ext-frame-cad hardware). Bought, not made: no process.
 */
import { defineCapabilityConfig } from "@protoboardai/core";

export default defineCapabilityConfig({ provider: "@protoboardai/ext-frame-cad", module: "iso-4762-m2x18" });
